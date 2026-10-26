import { describe, it, expect, beforeAll } from "vitest";
import { setup, fetch } from "@nuxt/test-utils/e2e";
import { v4 as uuidv4 } from "uuid";
import { setupDatabase } from "../../app/lib/databaseSetup";
import { hashToken } from "../../server/utils/auth";

const jsonPost = (path: string, body: unknown) =>
  fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

// Session-protected endpoints accept the token via `Authorization: Bearer`.
const authGet = (path: string, token: string) =>
  fetch(path, { headers: { authorization: `Bearer ${token}` } });
const authPost = (path: string, token: string, body: unknown = {}) =>
  fetch(path, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

// Builds and starts the real Nuxt server (connecting to the test database and
// running migrations at startup), then drives the auth HTTP surface end-to-end.
describe("auth endpoints (e2e)", async () => {
  await setup({
    server: true,
    // Disable sourcemaps for the e2e build: Rollup otherwise hits a
    // "Multiple conflicting contents for sourcemap source" error on some .vue
    // files. Sourcemaps aren't needed for these black-box HTTP tests.
    nuxtConfig: {
      sourcemap: { server: false, client: false },
    },
  });

  const signIn = (body: unknown) =>
    fetch("/api/auth/sign-in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  // Run-unique ids/tokens so the suite is re-runnable against the same DB.
  const run = Date.now();
  const regularUserId = `e2e-regular-${run}`;
  const adminUserId = `e2e-admin-${run}`;
  const REGULAR_TOKEN = `e2e-regular-token-${run}`;
  const ADMIN_TOKEN = `e2e-admin-token-${run}`;
  const SIGNOUT_TOKEN = `e2e-signout-token-${run}`;

  beforeAll(async () => {
    const db = setupDatabase();
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.execute(
      "INSERT INTO `user` (id, name, email, emailVerified, role) VALUES (?,?,?,?,?), (?,?,?,?,?)",
      [
        regularUserId, "Regular", `reg-${run}@example.com`, 1, "user",
        adminUserId, "Admin", `adm-${run}@example.com`, 1, "admin",
      ],
    );
    await db.execute(
      "INSERT INTO `session` (id, expiresAt, token, userId) VALUES (?,?,?,?), (?,?,?,?), (?,?,?,?)",
      [
        `sess-reg-${run}`, future, hashToken(REGULAR_TOKEN), regularUserId,
        `sess-adm-${run}`, future, hashToken(ADMIN_TOKEN), adminUserId,
        `sess-out-${run}`, future, hashToken(SIGNOUT_TOKEN), regularUserId,
      ],
    );
  });

  it("rejects a non-POST method with 405", async () => {
    const res = await fetch("/api/auth/sign-in");
    expect(res.status).toBe(405);
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await signIn({});
    expect(res.status).toBe(400);
  });

  it("returns 401 for valid-format but unknown credentials", async () => {
    const res = await signIn({
      email: "nobody@example.com",
      password: "password123",
    });
    expect(res.status).toBe(401);
  });

  it("registers a new user when signup is enabled", async () => {
    const email = `signup-${Date.now()}@example.com`;
    const res = await jsonPost("/api/auth/sign-up", {
      name: "New User",
      email,
      password: "password123",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body?.data?.success).toBe(true);
  });

  it("returns a generic success for an unknown reset-password email", async () => {
    const res = await jsonPost("/api/auth/request-password", {
      email: "doesnotexist@example.com",
    });
    expect(res.status).toBe(200); // no user, no email sent, no enumeration
  });

  it("resets a password via a valid token, then signs in with the new one", async () => {
    // Seed a user + local account + a valid (unexpired) reset token.
    const db = setupDatabase();
    const email = `reset-${Date.now()}@example.com`;
    const userId = uuidv4();
    const token = uuidv4(); // reset-password requires a UUID-format token
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.execute(
      "INSERT INTO `user` (id, name, email, emailVerified, role) VALUES (?,?,?,?,?)",
      [userId, "Reset User", email, 1, "user"],
    );
    await db.execute(
      "INSERT INTO `account` (id, accountId, providerId, userId, password) VALUES (?,?,?,?,?)",
      [uuidv4(), email, "local", userId, "placeholder-will-be-overwritten"],
    );
    await db.execute(
      "INSERT INTO `verification` (id, identifier, value, expiresAt) VALUES (?,?,?,?)",
      [uuidv4(), email, hashToken(token), future],
    );

    const newPassword = "newpassword123";
    const resetRes = await jsonPost("/api/auth/reset-password", {
      token,
      newPassword,
    });
    expect(resetRes.status).toBe(200);

    // The password really changed: signing in with it succeeds.
    const signInRes = await signIn({ email, password: newPassword });
    expect(signInRes.status).toBe(200);

    // The link is spent.
    const again = await jsonPost("/api/auth/reset-password", { token, newPassword });
    expect(again.status).toBe(400);
  });

  it("stores a reset link only as its hash, and answers before the mail goes out", async () => {
    const db = setupDatabase();
    const email = `reset-request-${Date.now()}@example.com`;
    await db.execute(
      "INSERT INTO `user` (id, name, email, emailVerified, role) VALUES (?,?,?,?,?)",
      [uuidv4(), "Reset Request", email, 1, "user"],
    );
    // The mail server here refuses connections. Before v0.41.0 the send was
    // awaited for existing accounts only, so this answered 500 for an address
    // with an account and 200 for one without.
    const res = await jsonPost("/api/auth/request-password", { email });
    expect(res.status).toBe(200);
    const [rows]: any = await db.execute(
      "SELECT `value` FROM `verification` WHERE `identifier` = ?",
      [email],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stores only the hash of a session token", async () => {
    const db = setupDatabase();
    const email = `hashed-session-${Date.now()}@example.com`;
    const created = await jsonPost("/api/auth/sign-up", { name: "Hashed", email, password: "password123" });
    expect(created.status).toBe(200);
    const res = await signIn({ email, password: "password123" });
    expect(res.status).toBe(200);
    const token = (await res.json())?.data?.sessionToken;
    expect(typeof token).toBe("string");
    const [rows]: any = await db.execute(
      "SELECT s.`token` FROM `session` s JOIN `user` u ON u.id = s.userId WHERE u.email = ?",
      [email],
    );
    expect(rows.map((r: any) => r.token)).toContain(hashToken(token));
    expect(rows.map((r: any) => r.token)).not.toContain(token);
    expect((await authGet("/api/auth/get-session", token)).status).toBe(200);
  });

  it("refuses a second account for an address, in any case", async () => {
    const email = `taken-${Date.now()}@example.com`;
    const first = await jsonPost("/api/auth/sign-up", { name: "First", email, password: "password123" });
    expect(first.status).toBe(200);
    const second = await jsonPost("/api/auth/sign-up", {
      name: "Second",
      email: email.toUpperCase(),
      password: "password123",
    });
    expect(second.status).toBe(400);
    expect((await second.json()).error).toBe("Registration failed");
  });

  it("frees an address an admin changed, for a new sign-up", async () => {
    // Before v0.41.0 the local account kept the old address as its key, so
    // signing up with the freed address hit a duplicate key and answered 500.
    const db = setupDatabase();
    const oldEmail = `before-${Date.now()}@example.com`;
    const created = await jsonPost("/api/auth/sign-up", { name: "Mover", email: oldEmail, password: "password123" });
    expect(created.status).toBe(200);
    const userId = (await created.json())?.data?.user?.id;

    const update = await authPost("/api/auth/admin/update", ADMIN_TOKEN, {
      userId,
      email: `after-${Date.now()}@example.com`,
    });
    expect(update.status).toBe(200);

    const reuse = await jsonPost("/api/auth/sign-up", { name: "Newcomer", email: oldEmail, password: "password123" });
    expect(reuse.status).toBe(200);

    // And the moved account still signs in, at its new address.
    const [[moved]]: any = await db.execute("SELECT `email` FROM `user` WHERE `id` = ?", [userId]);
    expect((await signIn({ email: moved.email, password: "password123" })).status).toBe(200);
  });

  it("get-session returns 401 without authentication", async () => {
    const res = await fetch("/api/auth/get-session");
    expect(res.status).toBe(401);
  });

  it("get-session returns the user when authenticated", async () => {
    const res = await authGet("/api/auth/get-session", REGULAR_TOKEN);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body?.data?.user?.id).toBe(regularUserId);
  });

  it("supports the API key lifecycle (create, list, delete)", async () => {
    const createRes = await authPost("/api/auth/api-key/create", REGULAR_TOKEN, {
      name: "e2e key",
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json();
    expect(created.success).toBe(true);
    expect(typeof created.key).toBe("string");
    const keyId = created.id;

    const listRes = await authGet("/api/auth/api-key/list", REGULAR_TOKEN);
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(list.apiKeys.some((k: any) => k.id === keyId)).toBe(true);

    const delRes = await authPost("/api/auth/api-key/delete", REGULAR_TOKEN, {
      keyId,
    });
    expect(delRes.status).toBe(200);
  });

  it("admin/list is forbidden for non-admins and allowed for admins", async () => {
    const forbidden = await authGet("/api/auth/admin/list", REGULAR_TOKEN);
    expect(forbidden.status).toBe(403);

    const allowed = await authGet("/api/auth/admin/list", ADMIN_TOKEN);
    expect(allowed.status).toBe(200);
    const body = await allowed.json();
    expect(body.success).toBe(true);
  });

  it("sign-out invalidates the session", async () => {
    const res = await authPost("/api/auth/sign-out", SIGNOUT_TOKEN);
    expect(res.status).toBe(200);
    // The session is gone: reusing the token now fails.
    const after = await authGet("/api/auth/get-session", SIGNOUT_TOKEN);
    expect(after.status).toBe(401);
  });

  // Keep this last: it exhausts the per-IP failed-login budget.
  it("rate-limits repeated failed logins with 429", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await signIn({
        email: "bruteforce@example.com",
        password: "password123",
      });
      statuses.push(res.status);
    }
    // Early attempts are 401 (bad creds); once the limit is hit they become 429.
    expect(statuses).toContain(401);
    expect(statuses).toContain(429);
    expect(statuses[statuses.length - 1]).toBe(429);
  });
});
