// Passwords, impersonation, and what is somebody's to change.
//
// An account that came through single sign-on has no password: the provider is
// its only way in, and resetting a password must not quietly give it a second
// one — while an administrator who sets a password for it means it. A password
// is written to the account's own local sign-in only, never into its SSO
// sign-ins. Ending an impersonation ends the very session that was
// impersonating, however it was sent. And a board's settings are its owner's:
// somebody who may edit the board is told so, not told the board is not there.
//
// Requires a built app (`npm run build`) and the credentials in `.env.local`.
// Creates and drops a database of its own.
import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const DB = "lokalboards_accounts";
const PORT = 3100, BASE = `http://127.0.0.1:${PORT}`;
const creds = { host: env.NUXT_MYSQL_HOST, user: env.NUXT_MYSQL_USER, password: env.NUXT_MYSQL_PASSWORD };

const admin = await mysql.createConnection(creds);
await admin.query(`DROP DATABASE IF EXISTS \`${DB}\``);
await admin.query(`CREATE DATABASE \`${DB}\``);
await admin.end();

const child = spawn("node", [".output/server/index.mjs"], {
  env: { ...process.env, ...env, NUXT_MYSQL_DATABASE: DB, NUXT_MYSQL_SSL: "false",
         NUXT_PUBLIC_SIGNUP: "true", PORT: String(PORT), NITRO_PORT: String(PORT),
         NUXT_BOARDS_URL: BASE, NUXT_LOG_LEVEL: "error", NUXT_LANGUAGE: "en",
         // Mail goes nowhere.
         NUXT_EMAIL_HOST: "127.0.0.1", NUXT_EMAIL_PORT: "9" },
  stdio: ["ignore", "pipe", "pipe"],
});
for (let i = 0; i < 160; i++) {
  try { if ((await fetch(BASE + "/")).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
const c = await mysql.createConnection({ ...creds, database: DB, timezone: "Z" });
await c.query("SET time_zone = '+00:00'");
for (let i = 0; i < 200; i++) {
  const [r] = await c.query("SELECT 1 FROM `migrations` WHERE `id` LIKE '0036%'").catch(() => [[]]);
  if (r.length) break;
  await new Promise((r) => setTimeout(r, 250));
}

let failures = 0;
const stop = async () => {
  child.kill("SIGKILL");
  await c.end().catch(() => {});
  const cleanup = await mysql.createConnection(creds);
  await cleanup.query(`DROP DATABASE IF EXISTS \`${DB}\``);
  await cleanup.end();
};

try {
  const check = (name, ok, detail = "") => {
    console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? " — " + detail : ""}`);
    if (!ok) failures++;
  };
  const post = (path, body, headers = {}) => fetch(`${BASE}${path}`, {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  });
  const tokenOf = (res) => (res.headers.getSetCookie?.() ?? []).map((x) => x.split(";")[0])
    .find((x) => x.startsWith("session_token="))?.split("=").slice(1).join("=");
  const account = async (name, email) => {
    await post("/api/auth/sign-up", { name, email, password: "correct horse battery" });
    const token = tokenOf(await post("/api/auth/sign-in", { email, password: "correct horse battery" }));
    const [[row]] = await c.query("SELECT id FROM `user` WHERE email = ?", [email]);
    await c.query("UPDATE `user` SET onboarded = 1 WHERE id = ?", [row.id]);
    return { id: row.id, token, cookie: `session_token=${token}` };
  };
  // Whether this is the password of the account's own sign-in — read from the
  // database rather than by signing in, which is throttled per address.
  const localPasswordIs = async (userId, password) => {
    const [[row]] = await c.query("SELECT password FROM account WHERE userId = ? AND providerId = 'local'", [userId]);
    return !!row?.password && bcrypt.compare(password, row.password);
  };

  const boss = await account("Boss", "boss@example.test");
  await c.query("UPDATE `user` SET role = 'admin' WHERE id = ?", [boss.id]);
  const anna = await account("Anna", "anna@example.test");

  // Somebody who only ever came through the provider: no local sign-in at all.
  const ssoId = randomUUID();
  await c.execute("INSERT INTO `user` (id, name, email, emailVerified, onboarded) VALUES (?,?,?,1,1)", [ssoId, "Sam", "sam@example.test"]);
  await c.execute("INSERT INTO `account` (id, accountId, providerId, userId) VALUES (?,?,?,?)", [randomUUID(), "subject-sam", "sso", ssoId]);
  // And somebody with both: a password, and a provider linked to the account.
  await c.execute("INSERT INTO `account` (id, accountId, providerId, userId) VALUES (?,?,?,?)", [randomUUID(), "subject-anna", "sso", anna.id]);

  // ----------------------------------------------------------- passwords ----
  console.log("\npasswords");
  await post("/api/auth/request-password", { email: "sam@example.test" });
  await post("/api/auth/request-password", { email: "anna@example.test" });
  await new Promise((r) => setTimeout(r, 300));
  const [links] = await c.query("SELECT identifier FROM verification");
  check("a reset link goes to somebody with a password, not to somebody who signs in through SSO only",
    links.length === 1 && links[0].identifier === "anna@example.test", JSON.stringify(links));

  // A link for the SSO-only account, as if one had been sent before.
  // Links carry a UUID; anything else is refused before it is looked up.
  const forged = randomUUID();
  await c.execute("INSERT INTO verification (id, identifier, value, expiresAt) VALUES (?,?,?, NOW() + INTERVAL 1 DAY)",
    [randomUUID(), "sam@example.test", createHash("sha256").update(forged).digest("hex")]);
  const samReset = await post("/api/auth/reset-password", { token: forged, newPassword: "a brand new password" });
  const [[samLocal]] = await c.query("SELECT COUNT(*) AS n FROM account WHERE userId = ? AND providerId = 'local'", [ssoId]);
  check("and a reset gives an SSO-only account no password", samReset.status === 400 && samLocal.n === 0,
    `${samReset.status}, ${samLocal.n} local`);

  const annaLink = randomUUID();
  await c.execute("INSERT INTO verification (id, identifier, value, expiresAt) VALUES (?,?,?, NOW() + INTERVAL 1 DAY)",
    [randomUUID(), "anna@example.test", createHash("sha256").update(annaLink).digest("hex")]);
  const annaReset = await post("/api/auth/reset-password", { token: annaLink, newPassword: "anna's new password" });
  const [[annaSso]] = await c.query("SELECT password FROM account WHERE userId = ? AND providerId = 'sso'", [anna.id]);
  check("a reset changes the password of the account's own sign-in", annaReset.status === 200 && (await localPasswordIs(anna.id, "anna's new password")), String(annaReset.status));
  check("and leaves its SSO sign-in without one", annaSso.password === null, String(annaSso.password));
  // A reset ends every session, so Anna signs in again.
  anna.token = tokenOf(await post("/api/auth/sign-in", { email: "anna@example.test", password: "anna's new password" }));
  anna.cookie = `session_token=${anna.token}`;

  const set = await post("/api/auth/admin/update", { userId: ssoId, password: "set by the admin" }, { cookie: boss.cookie });
  const [samRows] = await c.query("SELECT providerId, password FROM account WHERE userId = ? ORDER BY providerId", [ssoId]);
  check("an administrator setting a password gives an SSO account a local sign-in",
    set.status === 200 && (await localPasswordIs(ssoId, "set by the admin")), String(set.status));
  check("next to its SSO sign-in, which stays without a password",
    samRows.length === 2 && samRows.find((r) => r.providerId === "sso").password === null && await bcrypt.compare("set by the admin", samRows.find((r) => r.providerId === "local").password),
    JSON.stringify(samRows.map((r) => r.providerId)));

  // ------------------------------------------------------- impersonation ----
  console.log("\nimpersonation");
  const as = await post("/api/auth/admin/impersonate", { userId: anna.id }, { cookie: boss.cookie });
  const impersonating = tokenOf(as);
  const hash = (token) => createHash("sha256").update(token).digest("hex");
  const [[before]] = await c.query("SELECT COUNT(*) AS n FROM session WHERE token = ? AND impersonatedBy = ?", [hash(impersonating), boss.id]);
  // Sent as a bearer token, with an unrelated session in the cookie.
  const back = await post("/api/auth/admin/stop-impersonate", {}, { authorization: `Bearer ${impersonating}`, cookie: anna.cookie });
  const [[after]] = await c.query("SELECT COUNT(*) AS n FROM session WHERE token = ?", [hash(impersonating)]);
  const [[annas]] = await c.query("SELECT COUNT(*) AS n FROM session WHERE token = ?", [hash(anna.token)]);
  check("ending an impersonation sent as a bearer token ends that session",
    as.status === 200 && before.n === 1 && back.status === 200 && after.n === 0, `${as.status} ${back.status} ${before.n}→${after.n}`);
  check("and leaves the session in the cookie alone", annas.n === 1);

  // ----------------------------------------------------- board settings ----
  console.log("\nboard settings");
  const [board] = await c.execute("INSERT INTO boards (user, name, status) VALUES (?,?,?)", [boss.id, "Boss's board", "private"]);
  await c.execute("INSERT INTO invitations (board, user, permission) VALUES (?,?,?)", [board.insertId, anna.id, "edit"]);
  const settings = await post("/api/data/board", { id: board.insertId, userId: anna.id, name: "Renamed", style: "kanban", status: "private" }, { cookie: anna.cookie });
  check("somebody who may edit a board but does not own it is refused its settings with a 403", settings.status === 403, String(settings.status));
  const [[unchanged]] = await c.query("SELECT name FROM boards WHERE id = ?", [board.insertId]);
  check("and nothing changed", unchanged.name === "Boss's board");
} catch (error) {
  console.error(`\n FAIL  the run stopped early — ${error.message.split("\n")[0]}`);
  failures++;
} finally {
  await stop();
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures ? 1 : 0);
