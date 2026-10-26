import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { db, migrate, resetData, insertUser } from "./db";
import { createSession, hashToken, resolveSession } from "../../server/utils/auth";

beforeAll(async () => {
  await migrate();
});
beforeEach(async () => {
  await resetData();
});

// resolveSession reads the token from the Authorization header; providing it
// here means the cookie path (h3 getCookie) is never reached.
function eventWithToken(token: string): any {
  return { headers: new Headers({ authorization: `Bearer ${token}` }) };
}

// Sessions are stored by the token's hash; the client holds the token.
async function insertSession(token: string, userId: string, expiresAt: Date) {
  await db().execute(
    "INSERT INTO `session` (`id`,`expiresAt`,`token`,`userId`) VALUES (?,?,?,?)",
    [`sess-${token}`, expiresAt, hashToken(token), userId],
  );
}

// Generous margins so the comparison can't be flaky across DB/host timezones.
const DAY = 24 * 60 * 60 * 1000;
const future = () => new Date(Date.now() + DAY);
const past = () => new Date(Date.now() - DAY);

describe("resolveSession (integration, real MySQL)", () => {
  it("returns ok with the user for a valid session", async () => {
    await insertUser("u1");
    await insertSession("tok-valid-0001", "u1", future());

    const res = await resolveSession(eventWithToken("tok-valid-0001"));
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.user.id).toBe("u1");
      expect(res.user.email).toBe("u1@example.com");
    }
  });

  it("returns invalid for an expired session", async () => {
    await insertUser("u1");
    await insertSession("tok-expired-001", "u1", past());

    const res = await resolveSession(eventWithToken("tok-expired-001"));
    expect(res.status).toBe("invalid");
  });

  it("returns banned for a banned user", async () => {
    await insertUser("u1", { banned: 1 });
    await insertSession("tok-banned-0001", "u1", future());

    const res = await resolveSession(eventWithToken("tok-banned-0001"));
    expect(res.status).toBe("banned");
  });

  it("returns invalid for an unknown token", async () => {
    const res = await resolveSession(eventWithToken("tok-unknown-999"));
    expect(res.status).toBe("invalid");
  });

  it("returns invalid for a too-short token without hitting the DB", async () => {
    const res = await resolveSession(eventWithToken("short"));
    expect(res.status).toBe("invalid");
  });

  it("does not accept the stored hash as a token", async () => {
    await insertUser("u1");
    await insertSession("tok-valid-0002", "u1", future());
    const res = await resolveSession(eventWithToken(hashToken("tok-valid-0002")));
    expect(res.status).toBe("invalid");
  });

  it("stores only the hash of a new session's token", async () => {
    await insertUser("u1");
    const headers: Record<string, any> = {};
    const event: any = {
      headers: new Headers(),
      node: {
        req: { headers: {} },
        res: {
          getHeader: (name: string) => headers[name.toLowerCase()],
          setHeader: (name: string, value: any) => (headers[name.toLowerCase()] = value),
        },
      },
      context: {},
    };
    vi.stubGlobal("useRuntimeConfig", () => ({ sessionMaxAgeDays: "1", boardsUrl: "http://localhost:3000" }));
    try {
      const created: any = await createSession(event, "u1");
      expect(created.error).toBeUndefined();
      const [rows]: any = await db().execute("SELECT `token` FROM `session` WHERE `userId` = ?", ["u1"]);
      expect(rows).toHaveLength(1);
      expect(rows[0].token).toBe(hashToken(created.sessionToken));
      expect(rows[0].token).not.toContain(created.sessionToken);
      expect(String(headers["set-cookie"])).toContain(`session_token=${created.sessionToken}`);
      expect((await resolveSession(eventWithToken(created.sessionToken))).status).toBe("ok");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
