// Signing in over plain HTTP, and the API taking what its reference says is
// optional — the two things a NixOS test run turned up.
//
// The server runs as the Docker image and the Nix package run it, as a
// production build, reached over http:// the way the quick start is. The session
// cookie used to be marked Secure there regardless, so Safari refused to keep it
// even on localhost, and every browser refused it under any other name: sign-in
// answered 200 and the sign-in page came straight back. It is checked here in
// WebKit on localhost and in Chromium under a hostname that is not localhost,
// alongside the flag itself for plain HTTP and for a TLS proxy.
//
// Requires a built app (`npm run build`), Playwright's Chromium and WebKit, and
// the credentials in `.env.local`. Creates and drops a database of its own.
import fs from "node:fs";
import { spawn } from "node:child_process";
import mysql from "mysql2/promise";
import { chromium, webkit } from "playwright";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const DB = "lokalboards_quickstart";
const PORT = 3100, BASE = `http://127.0.0.1:${PORT}`;
const creds = { host: env.NUXT_MYSQL_HOST, user: env.NUXT_MYSQL_USER, password: env.NUXT_MYSQL_PASSWORD };

const admin = await mysql.createConnection(creds);
await admin.query(`DROP DATABASE IF EXISTS \`${DB}\``);
await admin.query(`CREATE DATABASE \`${DB}\``);
await admin.end();

const child = spawn("node", [".output/server/index.mjs"], {
  env: { ...process.env, ...env, NODE_ENV: "production", NUXT_MYSQL_DATABASE: DB, NUXT_MYSQL_SSL: "false",
         NUXT_PUBLIC_SIGNUP: "true", PORT: String(PORT), NITRO_PORT: String(PORT),
         NUXT_BOARDS_URL: `http://localhost:${PORT}`, NUXT_LOG_LEVEL: "error", NUXT_LANGUAGE: "en" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOutput = "";
child.stdout.on("data", (chunk) => { serverOutput += chunk; });
child.stderr.on("data", (chunk) => { serverOutput += chunk; });
for (let i = 0; i < 160; i++) {
  try { if ((await fetch(BASE + "/")).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
const c = await mysql.createConnection({ ...creds, database: DB });
for (let i = 0; i < 200; i++) {
  const [r] = await c.query("SELECT 1 FROM `migrations` WHERE `id` LIKE '0028%'").catch(() => [[]]);
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

  const email = "owner@example.test", password = "correct horse battery";
  await fetch(`${BASE}/api/auth/sign-up`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Owner", email, password }) });
  await c.query("UPDATE `user` SET onboarded = 1");

  // --------------------------------------------------------- the flag ------
  const signIn = (headers = {}) => fetch(`${BASE}/api/auth/sign-in`, {
    method: "POST", headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ email, password }),
  });
  const sessionCookie = (response) => (response.headers.getSetCookie?.() ?? []).find((x) => x.startsWith("session_token=")) ?? "";

  const plain = await signIn();
  const plainCookie = sessionCookie(plain);
  check("over plain HTTP the session cookie is set", plain.status === 200 && plainCookie !== "", `status ${plain.status}`);
  check("and is not marked Secure, although this is a production build", !/;\s*secure/i.test(plainCookie), plainCookie.replace(/=[^;]+/, "=…"));
  check("behind a TLS proxy it is", /;\s*secure/i.test(sessionCookie(await signIn({ "x-forwarded-proto": "https" }))));
  check("and a chain of proxies is read by the browser's own hop", /;\s*secure/i.test(sessionCookie(await signIn({ "x-forwarded-proto": "https, http" }))));

  // ------------------------------------------------------ in a browser -----
  const browserSignIn = async (engine, base, args = []) => {
    const browser = await engine.launch({ args });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(`${base}/`, { waitUntil: "load" });
      await page.fill("input[type=email]", email);
      await page.fill("input[type=password]", password);
      await page.click("input[type=submit]");
      await page.waitForURL((url) => url.pathname.startsWith("/dashboard"), { timeout: 15000 }).catch(() => {});
      const kept = (await context.cookies()).some((cookie) => cookie.name === "session_token");
      return { path: new URL(page.url()).pathname, kept };
    } finally {
      await browser.close();
    }
  };
  const safari = await browserSignIn(webkit, `http://localhost:${PORT}`);
  check("WebKit signs in on http://localhost, as the quick start is opened", safari.path.startsWith("/dashboard") && safari.kept, JSON.stringify(safari));
  // A name that is not localhost, resolved to this server inside the browser only.
  const named = await browserSignIn(chromium, `http://boards.lan:${PORT}`, [`--host-resolver-rules=MAP boards.lan 127.0.0.1`]);
  check("Chromium signs in under a hostname that is not localhost", named.path.startsWith("/dashboard") && named.kept, JSON.stringify(named));

  // ----------------------------------------- the API, as documented -------
  const cookie = plainCookie.split(";")[0];
  const [[me]] = await c.query("SELECT id FROM `user` WHERE email = ?", [email]);
  const post = async (path, body) => {
    const response = await fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  const board = await post("/api/data/board", { userId: me.id, name: "Only what is required", style: "kanban", status: "private" });
  check("a board can be created with only its required fields", board.status === 200 && Number(board.body.board?.id) > 0, `${board.status} ${JSON.stringify(board.body).slice(0, 80)}`);
  const [[row]] = await c.query("SELECT image, color FROM boards WHERE id = ?", [board.body.board?.id ?? 0]).catch(() => [[{}]]);
  check("and has no image and no colour", row?.image === null && row?.color === null, JSON.stringify(row));
  const area = await post("/api/data/area", { boardId: board.body.board?.id, name: "Todo" });
  check("an area likewise", area.status === 200 && Number(area.body.area?.id) > 0, `${area.status}`);
  const card = await post("/api/data/card", { areaId: area.body.area?.id, name: "Nothing but a name" });
  check("and a card", card.status === 200 && Number(card.body.card?.id) > 0, `${card.status}`);

  // Signing up sends a welcome email, and there is no mail server here to take it.
  const errors = serverOutput.split("\n").filter((line) => line.includes('"level":"error"') && !/email/i.test(line.match(/"msg":"([^"]*)"/)?.[1] ?? ""));
  check("the server logged no errors", errors.length === 0, errors.join(" ").slice(0, 200));
} catch (error) {
  console.error(`\n FAIL  the run stopped early — ${error.message.split("\n")[0]}`);
  failures++;
} finally {
  await stop();
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures ? 1 : 0);
