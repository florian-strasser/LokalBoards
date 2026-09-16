// A comment appears once, and it appears everywhere.
//
// Two things went wrong here. A comment could be shown twice for a moment — the
// answer to your own POST and the copy the card dialog keeps, both putting it in
// the list — which is confusing in a place where people are talking to each
// other. And a card opened straight after the page loaded never joined its
// socket room at all: the browser asks to join its board and its card in the
// same tick, and the session lookup behind both calls returned "nobody" to the
// second one, so comments from other people only turned up on a reload.
//
// So: one tab writes a comment, the other must see it without being reloaded,
// and neither may ever show it twice — including after the card is closed and
// opened again, which rebuilds the list from the dialog's own copy.
//
// Requires a built app (`npm run build`) and the credentials in `.env.local`.
// Creates and drops a database of its own.
import fs from "node:fs";
import { spawn } from "node:child_process";
import mysql from "mysql2/promise";
import { chromium } from "playwright";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const DB = "lokalboards_commentslive";
const PORT = 3100, BASE = `http://127.0.0.1:${PORT}`;
const creds = { host: env.NUXT_MYSQL_HOST, user: env.NUXT_MYSQL_USER, password: env.NUXT_MYSQL_PASSWORD };

const admin = await mysql.createConnection(creds);
await admin.query(`DROP DATABASE IF EXISTS \`${DB}\``);
await admin.query(`CREATE DATABASE \`${DB}\``);
await admin.end();

const child = spawn("node", [".output/server/index.mjs"], {
  env: { ...process.env, ...env, NUXT_MYSQL_DATABASE: DB, NUXT_MYSQL_SSL: "false",
         NUXT_PUBLIC_SIGNUP: "true", PORT: String(PORT), NITRO_PORT: String(PORT),
         NUXT_BOARDS_URL: BASE, NUXT_LOG_LEVEL: "error", NUXT_LANGUAGE: "en" },
  stdio: ["ignore", "pipe", "pipe"],
});
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
let browser;
const stop = async () => {
  await browser?.close().catch(() => {});
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

  const account = async (name, email) => {
    await fetch(`${BASE}/api/auth/sign-up`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, email, password: "correct horse battery" }) });
    const signIn = await fetch(`${BASE}/api/auth/sign-in`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "correct horse battery" }) });
    const cookie = (signIn.headers.getSetCookie?.() ?? []).map((x) => x.split(";")[0])
      .find((x) => x.startsWith("session_token="));
    const [[row]] = await c.query("SELECT id FROM `user` WHERE email = ?", [email]);
    await c.query("UPDATE `user` SET onboarded = 1 WHERE id = ?", [row.id]);
    return { id: row.id, token: cookie.split("=").slice(1).join("=") };
  };
  const owner = await account("Florian", "owner@example.test");
  const colleague = await account("Anna", "anna@example.test");

  const [board] = await c.execute("INSERT INTO boards (user, name, status) VALUES (?,?,?)", [owner.id, "Talking", "private"]);
  await c.execute("INSERT INTO invitations (board, user, permission) VALUES (?,?,?)", [board.insertId, colleague.id, "edit"]);
  const [area] = await c.execute("INSERT INTO areas (board, name, sort) VALUES (?,?,?)", [board.insertId, "Todo", 0]);
  const [card] = await c.execute("INSERT INTO cards (area, name, content, sort) VALUES (?,?,?,?)", [area.insertId, "A card", "", 0]);
  const cardUrl = `${BASE}/board/${board.insertId}?card=${card.insertId}`;

  browser = await chromium.launch();
  const open = async (who) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
    await context.addCookies([{ name: "session_token", value: who.token, domain: "127.0.0.1", path: "/" }]);
    const page = await context.newPage();
    await page.goto(cardUrl, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    return page;
  };
  const writer = await open(owner);
  const reader = await open(colleague);

  const shown = (page) => page.evaluate(() => {
    const ids = [...document.querySelectorAll('[id^="comment-"]')].map((el) => el.id);
    return { count: ids.length, unique: new Set(ids).size };
  });

  const write = async (page, text) => {
    await page.locator('button:has-text("Write a comment")').first().click();
    await page.waitForTimeout(300);
    await page.locator("form .ProseMirror").first().click();
    await page.keyboard.type(text);
    // The editor hands its text to the form when it loses focus, which a real
    // click on the button does first.
    await page.locator("form .ProseMirror").first().evaluate((el) => el.blur());
    await page.waitForTimeout(200);
    await page.locator("form:has(.ProseMirror)").first().evaluate((f) => f.requestSubmit());
  };

  await write(writer, "Does this show up once?");

  // Whatever arrives and however often, the writer's own list never doubles.
  let worstForWriter = { count: 0, unique: 0 };
  for (let i = 0; i < 40; i++) {
    const seen = await shown(writer);
    if (seen.count > worstForWriter.count) worstForWriter = seen;
    await writer.waitForTimeout(100);
  }
  check("the comment is in the writer's list exactly once, at every moment",
    worstForWriter.count === 1 && worstForWriter.unique === 1, JSON.stringify(worstForWriter));

  // The other tab is never reloaded: this only works if its card joined the
  // socket room on the first open.
  let inReader = { count: 0, unique: 0 };
  for (let i = 0; i < 60 && inReader.count === 0; i++) {
    inReader = await shown(reader);
    await reader.waitForTimeout(100);
  }
  check("it reaches the other person's open card without a reload", inReader.count === 1, JSON.stringify(inReader));
  await reader.waitForTimeout(1500);
  check("and lands there once", (await shown(reader)).count === 1, JSON.stringify(await shown(reader)));

  // Reopening rebuilds the list from the copy the dialog keeps.
  await writer.keyboard.press("Escape");
  await writer.waitForTimeout(1000);
  await writer.locator(`[data-card-id="${card.insertId}"]`).first().click();
  await writer.waitForTimeout(1500);
  check("closing and reopening the card still shows it once", (await shown(writer)).count === 1, JSON.stringify(await shown(writer)));

  // The other way round, so the reader's own POST and the writer's socket copy
  // are both exercised.
  await write(reader, "And the other way round?");
  await writer.waitForTimeout(2500);
  const bothWays = await shown(writer);
  check("a comment from the other person arrives once as well", bothWays.count === 2 && bothWays.unique === 2, JSON.stringify(bothWays));

  const [[rows]] = await c.query("SELECT COUNT(*) AS n FROM comments");
  check("and the database holds exactly what was written", rows.n === 2, `${rows.n} rows`);
} catch (error) {
  console.error(`\n FAIL  the run stopped early — ${error.message.split("\n")[0]}`);
  failures++;
} finally {
  await stop();
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures ? 1 : 0);
