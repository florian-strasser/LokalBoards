// The bell's notifications arrive a page at a time.
//
// It used to fetch every notification an account had ever received in order to
// show the first handful. This checks the page size, that "show older" walks
// backwards through the rest without repeating or skipping a row, that the
// unread dot still counts what is off the page, and that the caller which wants
// the whole history — the board page, working out which cards to mark — still
// gets it.
//
// Requires a built app (`npm run build`) and the credentials in `.env.local`.
// Creates and drops a database of its own; it never touches an existing one.
import fs from "node:fs";
import { spawn } from "node:child_process";
import mysql from "mysql2/promise";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const DB = "lokalboards_paging", PORT = 3100, BASE = `http://127.0.0.1:${PORT}`;
const creds = { host: env.NUXT_MYSQL_HOST, user: env.NUXT_MYSQL_USER, password: env.NUXT_MYSQL_PASSWORD };

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
};

const admin = await mysql.createConnection(creds);
await admin.query(`DROP DATABASE IF EXISTS \`${DB}\``); await admin.query(`CREATE DATABASE \`${DB}\``); await admin.end();
const child = spawn("node", [".output/server/index.mjs"], {
  env: { ...process.env, ...env, NUXT_MYSQL_DATABASE: DB, NUXT_MYSQL_SSL: "false", PORT: String(PORT),
         NITRO_PORT: String(PORT), NUXT_BOARDS_URL: BASE, NUXT_LOG_LEVEL: "error", NUXT_LANGUAGE: "en" },
  stdio: ["ignore", "pipe", "pipe"] });
for (let i = 0; i < 160; i++) { try { if ((await fetch(BASE + "/")).ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); }
const c = await mysql.createConnection({ ...creds, database: DB });
for (let i = 0; i < 200; i++) { const [r] = await c.query("SELECT 1 FROM `migrations` WHERE `id` LIKE '0024%'").catch(() => [[]]); if (r.length) break; await new Promise(r => setTimeout(r, 250)); }

await fetch(`${BASE}/api/auth/sign-up`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "Owner", email: "owner@example.test", password: "correct horse battery" }) });
const signIn = await fetch(`${BASE}/api/auth/sign-in`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "owner@example.test", password: "correct horse battery" }) });
const cookie = (signIn.headers.getSetCookie?.() ?? []).map(x => x.split(";")[0]).find(x => x.startsWith("session_token="));
const [[user]] = await c.query("SELECT id FROM `user` LIMIT 1");
const [board] = await c.execute("INSERT INTO `boards` (user, name, status) VALUES (?,?,?)", [user.id, "Paging", "private"]);

// 60 notifications, oldest first, the newest 30 unread — more than one page of
// unread, which is exactly where a count taken from the page goes wrong.
const TOTAL = 60, UNREAD = 30;
for (let i = 0; i < TOTAL; i++) {
  await c.execute(
    "INSERT INTO `notifications` (userId, type, boardId, message, isRead, createdAt) VALUES (?,?,?,?,?,?)",
    [user.id, "comment", board.insertId, `Notification ${i + 1}`, i < TOTAL - UNREAD ? 1 : 0,
     new Date(Date.now() - (TOTAL - i) * 60000)]);
}

const get = async (qs) => await (await fetch(`${BASE}/api/data/notifications?${qs}`, { headers: { cookie } })).json();

console.log("\n1. the bell asks for a page and gets one");
const first = await get("limit=25");
check("twenty-five rows", first.notifications.length === 25, `${first.notifications.length}`);
check("newest first", first.notifications[0].message === `Notification ${TOTAL}`, first.notifications[0].message);
check("and it says there is more", first.hasMore === true, String(first.hasMore));

console.log("\n2. the dot counts what is not on the page");
check("every unread one, not just this page's",
  first.unreadCount === UNREAD, `${first.unreadCount} of ${UNREAD}`);

console.log("\n3. show older walks back through the rest");
const seen = new Map(first.notifications.map((n) => [n.id, n.message]));
let cursor = first.notifications[first.notifications.length - 1].id;
let pages = 1, more = first.hasMore;
while (more) {
  const page = await get(`limit=25&before=${cursor}`);
  pages += 1;
  for (const n of page.notifications) {
    if (seen.has(n.id)) { check("no row came back twice", false, `id ${n.id}`); }
    seen.set(n.id, n.message);
  }
  more = page.hasMore;
  if (page.notifications.length) cursor = page.notifications[page.notifications.length - 1].id;
}
check("three pages for sixty", pages === 3, `${pages} pages`);
check("every notification was seen exactly once", seen.size === TOTAL, `${seen.size} of ${TOTAL}`);
check("including the very oldest", [...seen.values()].includes("Notification 1"));
check("and the last page says there is no more", more === false, String(more));

console.log("\n4. a caller that wants the whole history still gets it");
const all = await get("");
check("every row, unpaged", all.notifications.length === TOTAL, `${all.notifications.length} of ${TOTAL}`);
check("and it does not claim there is more", all.hasMore === false, String(all.hasMore));

console.log("\n5. the page size cannot be used to ask for everything");
const huge = await get("limit=100000");
check("capped at a hundred", huge.notifications.length === 60 && huge.hasMore === false,
  `${huge.notifications.length} rows`);
const nonsense = await get("limit=abc");
check("nonsense is treated as unpaged", nonsense.notifications.length === TOTAL, `${nonsense.notifications.length}`);

console.log("\n6. one user cannot page through another's");
await c.execute("INSERT INTO `user` (id, name, email, emailVerified) VALUES (?,?,?,?)", ["other-user", "Other", "other@example.test", 1]);
await c.execute("INSERT INTO `notifications` (userId, type, boardId, message) VALUES (?,?,?,?)",
  ["other-user", "comment", board.insertId, "Not yours"]);
const [[theirs]] = await c.query("SELECT id FROM `notifications` WHERE userId = 'other-user'");
const cross = await get(`limit=25&before=${theirs.id}`);
check("their row is not in the list", !cross.notifications.some((n) => n.message === "Not yours"));
check("and their id is not a usable cursor", cross.notifications.length === 25, `${cross.notifications.length} rows`);

console.log("\n7. asking only which cards have something unread");
// Two cards on this board with unread notifications, one read, and one on a
// board of its own that must not leak into a board-scoped answer.
const [area] = await c.execute("INSERT INTO `areas` (board, name, sort) VALUES (?,?,?)", [board.insertId, "Todo", 0]);
const cardIds = [];
for (const [name, isRead] of [["A", 0], ["B", 0], ["C", 1]]) {
  const [row] = await c.execute("INSERT INTO `cards` (area, name, content, sort) VALUES (?,?,?,?)", [area.insertId, name, "", 0]);
  cardIds.push(row.insertId);
  await c.execute("INSERT INTO `notifications` (userId, type, boardId, cardId, message, isRead) VALUES (?,?,?,?,?,?)",
    [user.id, "comment", board.insertId, row.insertId, `On card ${name}`, isRead]);
}
const [other] = await c.execute("INSERT INTO `boards` (user, name, status) VALUES (?,?,?)", [user.id, "Elsewhere", "private"]);
await c.execute("INSERT INTO `notifications` (userId, type, boardId, cardId, message, isRead) VALUES (?,?,?,?,?,?)",
  [user.id, "comment", other.insertId, 999999, "Another board", 0]);

const unreadCards = await get(`unreadCards=1&boardId=${board.insertId}`);
check("only the cards, no messages", Array.isArray(unreadCards.cardIds) && !unreadCards.notifications,
  JSON.stringify(unreadCards).slice(0, 80));
check("the two unread ones", unreadCards.cardIds.includes(cardIds[0]) && unreadCards.cardIds.includes(cardIds[1]),
  unreadCards.cardIds.join(", "));
check("not the one already read", !unreadCards.cardIds.includes(cardIds[2]), unreadCards.cardIds.join(", "));
check("and not another board's", !unreadCards.cardIds.includes(999999), unreadCards.cardIds.join(", "));
const everywhere = await get("unreadCards=1");
check("unscoped, it spans the boards", everywhere.cardIds.includes(999999), everywhere.cardIds.join(", "));
const badBoard = await get("unreadCards=1&boardId=nope");
check("a bad board id is refused", !!badBoard.error, JSON.stringify(badBoard));

console.log("\n8. the bell shows a page and a button for the rest");
const { chromium } = await import("playwright");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.context().addCookies([{ name: cookie.split("=")[0], value: cookie.split("=").slice(1).join("="),
  domain: "127.0.0.1", path: "/" }]);
await c.execute("UPDATE `user` SET `onboarded` = 1");
await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
await page.locator('[aria-label="Notifications"]:visible').first().click();
await page.waitForTimeout(800);
const items = page.locator('div.fixed a[href^="/board/"]');
check("twenty-five in the panel", await items.count() === 25, `${await items.count()}`);
const button = page.locator('div.fixed button', { hasText: "Show older" });
check("the button is offered", await button.count() === 1, `${await button.count()}`);
// The button is at the end of a scrolling list; look at where it actually is.
await page.locator("div.fixed div.max-h-96").evaluate((el) => { el.scrollTop = el.scrollHeight; });
await page.waitForTimeout(400);
await page.screenshot({ path: `${process.argv[2] ?? "."}/bell-first-page.png`, clip: { x: 900, y: 60, width: 520, height: 620 } });
await button.click();
await page.waitForTimeout(900);
check("a second page is appended", await items.count() === 50, `${await items.count()}`);
await page.locator('div.fixed button', { hasText: "Show older" }).click();
await page.waitForTimeout(900);
// Counted, not assumed: the section above adds notifications of its own.
const [[{ total }]] = await c.query("SELECT COUNT(*) AS total FROM `notifications` WHERE userId = ?", [user.id]);
check("and the last one finishes the list", await items.count() === Number(total), `${await items.count()} of ${total}`);
check("the button goes away at the end",
  await page.locator('div.fixed button', { hasText: "Show older" }).count() === 0);
await page.screenshot({ path: `${process.argv[2] ?? "."}/bell-all-loaded.png`, clip: { x: 900, y: 60, width: 520, height: 620 } });

console.log("\n9. the board page still marks the cards with unread changes");
await page.goto(`${BASE}/board/${board.insertId}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const marked = await page.evaluate(() =>
  [...document.querySelectorAll("[data-card-id]")].map((el) => ({
    id: Number(el.dataset.cardId),
    marked: el.className.includes("ring-2"),
  })));
const markedIds = marked.filter((m) => m.marked).map((m) => m.id).sort();
check("the two unread cards are ringed", JSON.stringify(markedIds) === JSON.stringify([cardIds[0], cardIds[1]].sort()),
  `${markedIds.join(", ")} of ${marked.length} cards`);
check("the read one is not", !markedIds.includes(cardIds[2]), markedIds.join(", "));

await browser.close();

child.kill("SIGKILL");
const cleanup = await mysql.createConnection(creds); await cleanup.query(`DROP DATABASE IF EXISTS \`${DB}\``); await cleanup.end(); await c.end();
console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures ? 1 : 0);
