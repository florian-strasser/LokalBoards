// A card goes where it was put: a new one at the bottom, a moved one where it
// was dropped.
//
// A customer found new cards turning up in the middle of a column. A new card
// was numbered "how many cards the column has, plus one" — which is only the
// end of the column while the numbers have no gaps, and they get gaps: a card
// deleted for good, or an archived one cleared out after the retention period,
// takes its number with it. From then on the new card shared its number with a
// card further up, and the board put it in front of that one.
//
// Moving had the same blind spot the other way round. The board says where a
// card was dropped by counting the cards it shows; the server counted every
// card in the column, archived ones included, and treated the count as a
// number. With an archived card or a gap above the drop, the card landed a
// place or two higher than where it was let go.
//
// So: gaps and archived cards in every column, then new cards, reordering and
// moving — checked on the screen of the person doing it, on a colleague's
// screen that only hears about it, after a reload, and in the database. And a
// duplicated card, which is placed by the same code, still has to land directly
// under the card it was copied from.
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
const DB = "lokalboards_cardpositions";
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
  try { if ((await fetch(BASE + "/api/health")).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
const c = await mysql.createConnection({ ...creds, database: DB });

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
    return { id: row.id, cookie, token: cookie.split("=").slice(1).join("=") };
  };
  const owner = await account("Florian", "owner@example.test");
  const colleague = await account("Anna", "anna@example.test");

  // Everything below goes through the same endpoints the board uses, so the
  // numbers in the database are the ones the app itself wrote.
  const api = async (method, path, body) => {
    const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify(body) });
    return res.json();
  };
  const create = async (areaId, name) => (await api("POST", "/api/data/card", { areaId, name, status: false })).card.id;

  const [board] = await c.execute("INSERT INTO boards (user, name, status) VALUES (?,?,?)", [owner.id, "Positions", "private"]);
  await c.execute("INSERT INTO invitations (board, user, permission) VALUES (?,?,?)", [board.insertId, colleague.id, "edit"]);
  const area = async (name, sort) =>
    (await c.execute("INSERT INTO areas (board, name, sort) VALUES (?,?,?)", [board.insertId, name, sort]))[0].insertId;
  const todo = await area("Todo", 0);
  const moves = await area("Moves", 1);
  const target = await area("Target", 2);

  const ids = {};
  for (const name of ["A", "B", "C", "D", "E"]) ids[name] = await create(todo, name);
  for (const name of ["P", "Q", "R", "S"]) ids[name] = await create(moves, name);
  for (const name of ["X", "Y", "Z"]) ids[name] = await create(target, name);

  // The gaps: two cards gone for good, as the retention clean-up or "delete
  // permanently" leaves them. And an archived card in the middle of each of
  // the other two columns.
  await api("DELETE", "/api/data/card", { cardID: ids.B, permanent: true });
  await api("DELETE", "/api/data/card", { cardID: ids.C, permanent: true });
  await api("DELETE", "/api/data/card", { cardID: ids.Q });
  await api("DELETE", "/api/data/card", { cardID: ids.Y });

  // What the database says the column shows, and whether it can say it only
  // one way: two cards sharing a number have no order between them at all.
  const stored = async (areaId) => {
    const [rows] = await c.query(
      "SELECT name, sort FROM cards WHERE area = ? AND archivedAt IS NULL ORDER BY sort ASC, id ASC", [areaId]);
    const [[{ clashes }]] = await c.query(
      "SELECT COUNT(*) - COUNT(DISTINCT sort) AS clashes FROM cards WHERE area = ?", [areaId]);
    return { order: rows.map((r) => r.name).join(","), clashes: Number(clashes) };
  };
  const expectStored = async (label, areaId, order) => {
    const got = await stored(areaId);
    check(`${label} — in the database`, got.order === order && got.clashes === 0,
      `${got.order}${got.clashes ? `, ${got.clashes} shared position(s)` : ""}`);
  };

  browser = await chromium.launch();
  const open = async (who) => {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    await context.addCookies([{ name: "session_token", value: who.token, domain: "127.0.0.1", path: "/" }]);
    const page = await context.newPage();
    await page.goto(`${BASE}/board/${board.insertId}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    return page;
  };
  // The names down the Todo column, as drawn.
  const shown = (page) => page.evaluate(() => [...document.querySelectorAll("[data-card-id]")]
    .map((el) => el.innerText.split("\n")[0].trim())
    .filter((name) => ["A", "D", "E", "New card"].includes(name))
    .join(","));

  const mine = await open(owner);
  const theirs = await open(colleague);

  // --- A new card ----------------------------------------------------------
  console.log("\na new card in a column with gaps");
  await mine.locator('[data-testid="new-card-button"]').first().click();
  await mine.locator('[data-testid="new-card-input"]').first().fill("New card");
  await mine.locator('[data-testid="new-card-submit"]').first().click();
  await mine.waitForTimeout(1500);
  check("it is at the bottom for the person who made it", (await shown(mine)) === "A,D,E,New card", await shown(mine));
  check("and for a colleague watching the board", (await shown(theirs)) === "A,D,E,New card", await shown(theirs));
  await expectStored("and it is stored there", todo, "A,D,E,New card");
  await mine.reload({ waitUntil: "networkidle" });
  await mine.waitForTimeout(1000);
  check("and still there after a reload", (await shown(mine)) === "A,D,E,New card", await shown(mine));

  // --- A duplicate ---------------------------------------------------------
  console.log("\na duplicated card");
  await mine.locator(`[data-card-id="${ids.D}"]`).first().click();
  await mine.waitForTimeout(1200);
  await mine.locator('[role="dialog"] button[aria-haspopup="menu"], .shadow-xl button[aria-haspopup="menu"]').first().click();
  await mine.getByRole("button", { name: "Duplicate card" }).click();
  await mine.waitForTimeout(1500);
  await mine.keyboard.press("Escape");
  await mine.waitForTimeout(800);
  const withCopy = "A,D,D,E,New card";
  check("the copy sits right under the original for the person who made it", (await shown(mine)) === withCopy, await shown(mine));
  check("and for the colleague", (await shown(theirs)) === withCopy, await shown(theirs));
  await expectStored("and it is stored there", todo, withCopy);

  // --- Reordering past an archived card -------------------------------------
  // What the board sends when P is dragged to the second place of what it
  // shows: P, R, S with Q archived between P and R.
  console.log("\nreordering a column that has an archived card in it");
  await api("POST", "/api/data/cardOrder", { cardId: ids.P, areaId: moves, newIndex: 1 });
  await expectStored("P dragged below R lands below R", moves, "R,P,S");
  await api("POST", "/api/data/cardOrder", { cardId: ids.S, areaId: moves, newIndex: 0 });
  await expectStored("S dragged to the top lands at the top", moves, "S,R,P");

  // --- Moving into a column with an archived card ---------------------------
  console.log("\nmoving into a column that has an archived card in it");
  await api("POST", "/api/data/cardMove", { cardId: ids.S, fromAreaId: moves, toAreaId: target, newIndex: 1 });
  await expectStored("S dropped between X and Z lands between them", target, "X,S,Z");
  await expectStored("and the column it left keeps its order", moves, "R,P");
  await api("POST", "/api/data/cardMove", { cardId: ids.E, fromAreaId: todo, toAreaId: target, newIndex: 3 });
  await expectStored("E dropped at the bottom lands at the bottom", target, "X,S,Z,E");
  await expectStored("and the column it left keeps its order", todo, "A,D,D,New card");

  // --- And a new card after all that -----------------------------------------
  console.log("\na new card after the moves");
  await create(target, "Late");
  await expectStored("still goes to the bottom", target, "X,S,Z,E,Late");

  // --- The same through MCP ----------------------------------------------------
  // An assistant creates and moves cards through its own tools, which had
  // their own copy of the "count plus one" rule.
  console.log("\nthe same through MCP");
  const { key } = await (await fetch(`${BASE}/api/auth/api-key/create`, { method: "POST",
    headers: { "content-type": "application/json", cookie: owner.cookie },
    body: JSON.stringify({ name: "positions test" }) })).json();
  let rpcId = 0;
  const tool = async (name, args) => {
    const res = await fetch(`${BASE}/mcp`, { method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json",
                 accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }) });
    const text = await res.text();
    const json = text.trim().startsWith("{") ? JSON.parse(text)
      : JSON.parse(text.split("\n").filter((l) => l.startsWith("data:")).pop().slice(5));
    if (json.error || json.result?.isError) throw new Error(`${name}: ${JSON.stringify(json.error ?? json.result)}`);
    return JSON.parse(json.result.content[0].text);
  };
  const agent = await area("Agent", 3);
  for (const name of ["K", "L", "M", "N"]) ids[name] = await create(agent, name);
  await api("DELETE", "/api/data/card", { cardID: ids.K, permanent: true });
  await api("DELETE", "/api/data/card", { cardID: ids.M });
  await tool("createCard", { areaId: agent, name: "Bot" });
  await expectStored("a card an assistant creates goes to the bottom", agent, "L,N,Bot");
  const moved = await tool("moveCard", { cardId: ids.P, toAreaId: agent, position: 1 });
  await expectStored("one it moves lands where it said", agent, "L,P,N,Bot");
  check("and it reports that position back", moved.position === 1, JSON.stringify(moved.position));
  await tool("moveCard", { cardId: ids.R, toAreaId: agent });
  await expectStored("and with no position, at the bottom", agent, "L,P,N,Bot,R");

  // --- A card from somebody else's board -------------------------------------
  // Being allowed to edit both columns named in a move said nothing about the
  // card, which could come from a board the mover cannot even see.
  console.log("\nmoving a card from a board you have no access to");
  const stranger = await account("Mallory", "mallory@example.test");
  const [own] = await c.execute("INSERT INTO boards (user, name, status) VALUES (?,?,?)", [stranger.id, "Mine", "private"]);
  const [ownArea] = await c.execute("INSERT INTO areas (board, name, sort) VALUES (?,?,?)", [own.insertId, "Inbox", 0]);
  const res = await fetch(`${BASE}/api/data/cardMove`, { method: "POST",
    headers: { "content-type": "application/json", cookie: stranger.cookie },
    body: JSON.stringify({ cardId: ids.A, fromAreaId: ownArea.insertId, toAreaId: ownArea.insertId, newIndex: 0 }) });
  const [[a]] = await c.query("SELECT area FROM cards WHERE id = ?", [ids.A]);
  check("is refused", res.status === 404, String(res.status));
  check("and the card stays where it was", Number(a.area) === todo, `area ${a.area}`);
} catch (error) {
  console.error(`\n FAIL  the run stopped early — ${error.message.split("\n")[0]}`);
  failures++;
} finally {
  await stop();
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures ? 1 : 0);
