// Deleting a card, an area or a board archives it.
//
// The row stays, everything hanging off it stays, and `archivedAt` records when
// it left. What this checks is that "gone" really means gone from every list
// the app draws — the board, the dashboard, search, the reminders — while the
// thing itself is still there to be brought back, and that the one genuinely
// destructive path is still available and still destructive.
//
// Requires a built app (`npm run build`) and the credentials in `.env.local`.
// Creates and drops a database of its own; it never touches an existing one.
import fs from "node:fs";
import { spawn } from "node:child_process";
import mysql from "mysql2/promise";
import { chromium } from "playwright";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const DB = "lokalboards_archive";
const PORT = 3100, BASE = `http://127.0.0.1:${PORT}`;
const creds = { host: env.NUXT_MYSQL_HOST, user: env.NUXT_MYSQL_USER, password: env.NUXT_MYSQL_PASSWORD };

const admin = await mysql.createConnection(creds);
await admin.query(`DROP DATABASE IF EXISTS \`${DB}\``);
await admin.query(`CREATE DATABASE \`${DB}\``);
await admin.end();

const child = spawn("node", [".output/server/index.mjs"], {
  env: { ...process.env, ...env, NUXT_MYSQL_DATABASE: DB, NUXT_MYSQL_SSL: "false",
         NUXT_PUBLIC_SIGNUP: "true", PORT: String(PORT), NITRO_PORT: String(PORT),
         NUXT_BOARDS_URL: BASE, NUXT_LOG_LEVEL: "error" },
  stdio: ["ignore", "pipe", "pipe"],
});
for (let i = 0; i < 160; i++) {
  try { if ((await fetch(BASE + "/")).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
const c = await mysql.createConnection({ ...creds, database: DB });
for (let i = 0; i < 200; i++) {
  const [r] = await c.query("SELECT 1 FROM `migrations` WHERE `id` LIKE '0027%'").catch(() => [[]]);
  if (r.length) break;
  await new Promise((r) => setTimeout(r, 250));
}

let failures = 0;
let browser;
const stop = async () => {
  await browser?.close().catch(() => {});
  child.kill("SIGKILL");
  const cleanup = await mysql.createConnection(creds);
  await cleanup.query(`DROP DATABASE IF EXISTS \`${DB}\``);
  await cleanup.end();
  await c.end();
};

try {
  const check = (name, ok, detail = "") => {
    console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? " — " + detail : ""}`);
    if (!ok) failures++;
  };

  const signUp = async (name, email) => {
    await fetch(`${BASE}/api/auth/sign-up`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, email, password: "correct horse battery" }) });
    const res = await fetch(`${BASE}/api/auth/sign-in`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "correct horse battery" }) });
    return (res.headers.getSetCookie?.() ?? []).map((x) => x.split(";")[0]).find((x) => x.startsWith("session_token="));
  };
  const owner = await signUp("Owner", "owner@example.test");
  const reader = await signUp("Reader", "reader@example.test");

  const as = (cookie, path, init = {}) =>
    fetch(`${BASE}${path}`, { ...init, headers: { ...(init.headers || {}), cookie,
      ...(init.body ? { "content-type": "application/json" } : {}) } });
  const json = async (...args) => (await as(...args)).json();

  const [[me]] = await c.query("SELECT id FROM `user` WHERE email = 'owner@example.test'");
  const [board] = await c.execute("INSERT INTO boards (user, name, status) VALUES (?,?,?)", [me.id, "Archive", "private"]);
  const boardId = board.insertId;
  const [keep] = await c.execute("INSERT INTO areas (board, name, sort) VALUES (?,?,?)", [boardId, "Keep", 0]);
  const [away] = await c.execute("INSERT INTO areas (board, name, sort) VALUES (?,?,?)", [boardId, "Away", 1]);
  const [one] = await c.execute("INSERT INTO cards (area, name, content, sort) VALUES (?,?,?,?)", [keep.insertId, "Findable card", "", 0]);
  const [two] = await c.execute("INSERT INTO cards (area, name, content, sort) VALUES (?,?,?,?)", [keep.insertId, "Second card", "", 1]);
  const [inAway] = await c.execute("INSERT INTO cards (area, name, content, sort) VALUES (?,?,?,?)", [away.insertId, "Rides along", "", 0]);
  await c.execute("INSERT INTO comments (card, user, content, date) VALUES (?,?,?,NOW())", [one.insertId, me.id, "a comment"]);

  const cardsIn = async (areaId) =>
    (await json(owner, `/api/data/cards?areaId=${areaId}`)).cards?.map((x) => x.name) ?? [];
  const areaNames = async () =>
    (await json(owner, `/api/data/areas?boardId=${boardId}`)).areas?.map((x) => x.name) ?? [];
  const boardNames = async (cookie = owner) =>
    (await json(cookie, "/api/data/dashboard")).boards?.map((x) => x.name) ?? [];
  const archive = () => json(owner, `/api/data/archive?boardId=${boardId}`);
  const rowsOf = async (table, id) => {
    const [r] = await c.query(`SELECT archivedAt FROM \`${table}\` WHERE id = ?`, [id]);
    return r[0];
  };

  // ------------------------------------------------------------- a card ----
  await as(owner, "/api/data/card", { method: "DELETE", body: JSON.stringify({ cardID: one.insertId }) });
  check("an archived card leaves the board", !(await cardsIn(keep.insertId)).includes("Findable card"),
    JSON.stringify(await cardsIn(keep.insertId)));
  check("but the row is still there, dated", !!(await rowsOf("cards", one.insertId))?.archivedAt);
  const [[comments]] = await c.query("SELECT COUNT(*) AS total FROM comments WHERE card = ?", [one.insertId]);
  check("and everything hanging off it is kept", Number(comments.total) === 1);
  check("it is not in search either",
    !((await json(owner, "/api/data/search?q=Findable")).cards ?? []).some((x) => x.name === "Findable card"));
  check("the archive offers it back", ((await archive()).cards ?? []).some((x) => x.name === "Findable card"));

  await as(owner, "/api/data/archive", { method: "POST", body: JSON.stringify({ type: "card", id: one.insertId }) });
  check("restoring puts it back on the board", (await cardsIn(keep.insertId)).includes("Findable card"));
  check("and its history says what happened",
    ((await json(owner, `/api/data/card-activity?cardId=${one.insertId}`)).activity ?? [])
      .some((a) => a.type === "archived") &&
    ((await json(owner, `/api/data/card-activity?cardId=${one.insertId}`)).activity ?? [])
      .some((a) => a.type === "restored"));

  // ------------------------------------------------------------- an area ---
  await as(owner, `/api/data/area?id=${away.insertId}&boardId=${boardId}`, { method: "DELETE" });
  check("an archived area leaves the board", !(await areaNames()).includes("Away"), JSON.stringify(await areaNames()));
  check("its cards go with it without being touched",
    (await cardsIn(away.insertId)).length === 0 && !(await rowsOf("cards", inAway.insertId))?.archivedAt);
  check("the card inside it is not offered separately",
    !((await archive()).cards ?? []).some((x) => x.name === "Rides along"));
  check("the area is", ((await archive()).areas ?? []).some((x) => x.name === "Away"));

  await as(owner, "/api/data/archive", { method: "POST", body: JSON.stringify({ type: "area", id: away.insertId }) });
  check("restoring the area brings its cards back with it",
    (await areaNames()).includes("Away") && (await cardsIn(away.insertId)).includes("Rides along"));

  // ------------------------------------------------------------ a board ----
  await as(owner, `/api/data/board?id=${boardId}`, { method: "DELETE" });
  check("an archived board leaves the dashboard", !(await boardNames()).includes("Archive"));
  check("but it is still there", !!(await rowsOf("boards", boardId))?.archivedAt);
  check("and its cards are still there", (await c.query("SELECT COUNT(*) AS t FROM cards WHERE area = ?", [keep.insertId]))[0][0].t === 2);
  check("nothing on it turns up in search",
    ((await json(owner, "/api/data/search?q=Findable")).cards ?? []).length === 0);
  check("the account's archive offers the board",
    ((await json(owner, "/api/data/archive")).boards ?? []).some((x) => x.name === "Archive"));

  await as(owner, "/api/data/archive", { method: "POST", body: JSON.stringify({ type: "board", id: boardId }) });
  check("restoring puts it back on the dashboard", (await boardNames()).includes("Archive"));

  // ------------------------------------------------------- who may do it ---
  await c.execute("INSERT INTO invitations (board, user, permission) VALUES (?, (SELECT id FROM `user` WHERE email = 'reader@example.test'), ?)",
    [boardId, "read"]);
  const refusedArchive = await as(reader, "/api/data/card", { method: "DELETE", body: JSON.stringify({ cardID: two.insertId }) });
  check("a reader cannot archive a card", refusedArchive.status === 403, `status ${refusedArchive.status}`);
  const refusedList = await as(reader, `/api/data/archive?boardId=${boardId}`);
  check("nor read the archive", refusedList.status === 403, `status ${refusedList.status}`);

  // -------------------------------------------------------- and for good ---
  await as(owner, "/api/data/card", { method: "DELETE", body: JSON.stringify({ cardID: two.insertId }) });
  await as(owner, "/api/data/card", { method: "DELETE", body: JSON.stringify({ cardID: two.insertId, permanent: true }) });
  const [gone] = await c.query("SELECT id FROM cards WHERE id = ?", [two.insertId]);
  check("the archive can still delete something for good", gone.length === 0);

  // ----------------------------------------------------------- reminders ---
  await c.execute("UPDATE cards SET dueDate = NOW() + INTERVAL 5 MINUTE WHERE id = ?", [one.insertId]);
  await c.execute("INSERT INTO card_reminders (card, minutesBefore, notified) VALUES (?, ?, 0)", [one.insertId, 60]);
  await c.execute("UPDATE cards SET archivedAt = NOW() WHERE id = ?", [one.insertId]);
  const [[due]] = await c.query(
    `SELECT COUNT(*) AS total FROM card_reminders r
       JOIN cards cc ON cc.id = r.card
       JOIN areas a ON a.id = cc.area
       JOIN boards b ON b.id = a.board
      WHERE r.notified = 0 AND cc.archivedAt IS NULL AND a.archivedAt IS NULL AND b.archivedAt IS NULL
        AND cc.dueDate IS NOT NULL`);
  check("an archived card is nobody's reminder any more", Number(due.total) === 0, `${due.total} due`);
  await c.execute("UPDATE cards SET archivedAt = NULL WHERE id = ?", [one.insertId]);

  // ------------------------------------------------------------ the view ---
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.context().addCookies([{ name: "session_token", value: owner.split("=").slice(1).join("="),
    domain: "127.0.0.1", path: "/" }]);
  await as(owner, "/api/data/card", { method: "DELETE", body: JSON.stringify({ cardID: one.insertId }) });
  await page.goto(`${BASE}/board/${boardId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  check("the board draws without it", await page.locator('text=Findable card').count() === 0);

  await page.locator('button[aria-label="Weitere Optionen"], button[aria-label="More options"]').first()
    .click().catch(async () => {
      await page.locator("header button, h1 ~ * button").last().click();
    });
  await page.waitForTimeout(400);
  await page.locator("button", { hasText: /^\s*(Archiv|Archive)\s*$/ }).first().click();
  await page.waitForTimeout(900);
  check("the archive view lists it", await page.locator('text=Findable card').count() > 0);
  await page.locator("button", { hasText: /Wiederherstellen|Restore/ }).first().click();
  await page.waitForTimeout(1200);
  check("and restoring from it puts the card back on the board",
    (await cardsIn(keep.insertId)).includes("Findable card"));
} catch (error) {
  console.error(`\n FAIL  the run stopped early — ${error.message.split("\n")[0]}`);
  failures++;
} finally {
  await stop();
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures ? 1 : 0);
