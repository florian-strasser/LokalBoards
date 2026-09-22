// A card can be on several people.
//
// First the upgrade: a database with the old single `assignee` column, as every
// existing instance has, is started on this version, and everybody who was on a
// card has to still be on it afterwards — with the column gone, so nothing is
// left behind to disagree. Then the card dialog: people are put on and taken
// off one by one, the tile shows all of them, a colleague's board follows along
// live, and only the person put on by somebody else is told. The filter, My
// work and the older single `assignee` field keep working, somebody who is not
// on the board cannot be put on a card, and for agents claiming a card stays
// atomic: two claiming the same free card at the same moment, one gets it.
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
const DB = "lokalboards_assignees";
const PORT = 3100, BASE = `http://127.0.0.1:${PORT}`;
const creds = { host: env.NUXT_MYSQL_HOST, user: env.NUXT_MYSQL_USER, password: env.NUXT_MYSQL_PASSWORD };

const admin = await mysql.createConnection(creds);
await admin.query(`DROP DATABASE IF EXISTS \`${DB}\``);
await admin.query(`CREATE DATABASE \`${DB}\``);
await admin.end();

let child;
const start = async () => {
  child = spawn("node", [".output/server/index.mjs"], {
    env: { ...process.env, ...env, NUXT_MYSQL_DATABASE: DB, NUXT_MYSQL_SSL: "false",
           NUXT_PUBLIC_SIGNUP: "true", PORT: String(PORT), NITRO_PORT: String(PORT),
           NUXT_BOARDS_URL: BASE, NUXT_LOG_LEVEL: "error", NUXT_LANGUAGE: "en" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(BASE + "/api/health")).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("the server did not come up");
};
const halt = async () => {
  child?.kill("SIGKILL");
  await new Promise((r) => setTimeout(r, 500));
};
await start();
const c = await mysql.createConnection({ ...creds, database: DB });

let failures = 0;
let browser;
const stop = async () => {
  await browser?.close().catch(() => {});
  await halt();
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
    const [[row]] = await c.query("SELECT id FROM `user` WHERE email = ?", [email]);
    await c.query("UPDATE `user` SET onboarded = 1 WHERE id = ?", [row.id]);
    return { id: row.id, name, email };
  };
  const signIn = async (who) => {
    const res = await fetch(`${BASE}/api/auth/sign-in`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: who.email, password: "correct horse battery" }) });
    const cookie = (res.headers.getSetCookie?.() ?? []).map((x) => x.split(";")[0]).find((x) => x.startsWith("session_token="));
    return { ...who, cookie, token: cookie.split("=").slice(1).join("=") };
  };
  let owner = await account("Florian", "owner@example.test");
  let anna = await account("Anna", "anna@example.test");
  let ben = await account("Ben", "ben@example.test");
  let stranger = await account("Mallory", "mallory@example.test");

  const [board] = await c.execute("INSERT INTO boards (user, name, status) VALUES (?,?,?)", [owner.id, "Team", "private"]);
  for (const person of [anna, ben]) {
    await c.execute("INSERT INTO invitations (board, user, permission) VALUES (?,?,?)", [board.insertId, person.id, "edit"]);
  }
  const [area] = await c.execute("INSERT INTO areas (board, name, sort) VALUES (?,?,?)", [board.insertId, "Todo", 0]);
  const todo = area.insertId;
  const insertCard = async (name, sort) =>
    (await c.execute("INSERT INTO cards (area, name, content, sort) VALUES (?,?,?,?)", [todo, name, "", sort]))[0].insertId;
  const annas = await insertCard("Anna's old card", 0);
  const shared = await insertCard("Launch plan", 1);
  const free = await insertCard("Free for the taking", 2);
  const nobodys = await insertCard("Nobody's card", 3);

  // --- The upgrade ---------------------------------------------------------------
  // Put the database back the way the last release left it — the column, its
  // index, somebody in it, and no record of the migration — and start again.
  console.log("\nupgrading a database that has the old single column");
  await halt();
  await c.query("DROP TABLE card_assignees");
  await c.query("ALTER TABLE cards ADD COLUMN assignee varchar(255) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL");
  await c.query("CREATE INDEX cards_assignee ON cards (assignee)");
  await c.query("UPDATE cards SET assignee = ? WHERE id = ?", [anna.id, annas]);
  await c.query("DELETE FROM migrations WHERE id = '0030_card_assignees'");
  await start();
  const [carried] = await c.query("SELECT card, user FROM card_assignees ORDER BY id");
  check("everybody on a card is still on it", carried.length === 1 && carried[0].card === annas && carried[0].user === anna.id, JSON.stringify(carried));
  const [[column]] = await c.query("SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cards' AND COLUMN_NAME = 'assignee'");
  check("and the old column is gone", Number(column.n) === 0);

  owner = await signIn(owner);
  anna = await signIn(anna);
  ben = await signIn(ben);
  stranger = await signIn(stranger);
  const as = (who) => async (method, path, body) => {
    const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", cookie: who.cookie },
      body: method === "GET" ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const api = as(owner);
  const onCard = async (id) => (await c.query("SELECT user FROM card_assignees WHERE card = ? ORDER BY id", [id]))[0].map((row) => row.user);

  // --- The dialog --------------------------------------------------------------------
  console.log("\nputting people on a card");
  browser = await chromium.launch();
  const open = async (who, card) => {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    await context.addCookies([{ name: "session_token", value: who.token, domain: "127.0.0.1", path: "/" }]);
    const page = await context.newPage();
    await page.goto(`${BASE}/board/${board.insertId}${card ? `?card=${card}` : ""}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    return page;
  };
  const mine = await open(owner, shared);
  const theirs = await open(anna);

  await mine.locator(".shadow-xl.rounded-lg button", { has: mine.locator("svg.lucide-user-plus") }).first().click();
  const row = (name) => mine.locator("button[aria-pressed]", { hasText: name }).first();
  await row("Anna").click();
  await mine.waitForTimeout(700);
  await row("Florian").click();
  await mine.waitForTimeout(700);
  await row("Ben").click();
  await mine.waitForTimeout(1200);
  check("each click puts one more person on, and the menu stays open for the next",
    JSON.stringify(await onCard(shared)) === JSON.stringify([anna.id, owner.id, ben.id]), JSON.stringify(await onCard(shared)));
  await row("Ben").click();
  await mine.waitForTimeout(1200);
  check("clicking somebody who is on it takes them off", JSON.stringify(await onCard(shared)) === JSON.stringify([anna.id, owner.id]));
  await mine.keyboard.press("Escape");
  await mine.keyboard.press("Escape");
  await mine.waitForTimeout(900);

  const faces = (page, id) => page.locator(`[data-card-id="${id}"] [aria-label]`).evaluateAll(
    (els) => els.map((el) => el.getAttribute("aria-label")).filter((label) => label.includes(",") || !label.includes(" ")));
  check("the tile shows both of them", JSON.stringify(await faces(mine, shared)).includes("Anna, Florian"), JSON.stringify(await faces(mine, shared)));
  check("and so does the colleague's board, without a reload", JSON.stringify(await faces(theirs, shared)).includes("Anna, Florian"), JSON.stringify(await faces(theirs, shared)));

  const [told] = await c.query("SELECT userId FROM notifications WHERE type = 'card_assigned' AND cardId = ?", [shared]);
  const toldIds = told.map((row) => row.userId).sort();
  check("the people put on by somebody else are told, and nobody else",
    JSON.stringify(toldIds) === JSON.stringify([anna.id, ben.id].sort()), JSON.stringify(toldIds));
  const history = (await api("GET", `/api/data/card-activity?cardId=${shared}`)).body?.activity ?? [];
  check("the card's history says who came on and who went off",
    history.some((entry) => entry.type === "assigned" && entry.data?.removed && entry.data?.assigneeName === "Ben") &&
    history.filter((entry) => entry.type === "assigned" && !entry.data?.removed).length === 3,
    JSON.stringify(history.map((entry) => entry.data)));

  // --- The API -----------------------------------------------------------------
  console.log("\nthrough the API");
  const card = async (id) => (await api("GET", `/api/data/card?cardID=${id}`)).body.card;
  const got = await card(shared);
  check("a card says who is on it, and the first of them in the older field",
    got.assignees?.map((person) => person.name).join(",") === "Anna,Florian" && got.assignee === anna.id && got.assigneeName === "Anna");
  await api("PUT", "/api/data/card", { cardID: shared, name: "Launch plan", status: false, assignees: [ben.id, stranger.id] });
  check("somebody who is not on the board cannot be put on a card", JSON.stringify(await onCard(shared)) === JSON.stringify([ben.id]), JSON.stringify(await onCard(shared)));
  await api("PUT", "/api/data/card", { cardID: shared, name: "Launch plan", status: false });
  check("sending nobody at all leaves the people alone", JSON.stringify(await onCard(shared)) === JSON.stringify([ben.id]));
  await api("PUT", "/api/data/card", { cardID: shared, name: "Launch plan", status: false, assignee: anna.id });
  check("the older single `assignee` still works, and replaces everyone", JSON.stringify(await onCard(shared)) === JSON.stringify([anna.id]));
  await api("PUT", "/api/data/card", { cardID: shared, name: "Launch plan", status: false, assignees: [anna.id, ben.id] });

  const listed = (await api("GET", `/api/data/cards?areaId=${todo}&assignee=${ben.id}`)).body.cards.map((entry) => entry.name);
  check("the card list finds a shared card by either person", listed.includes("Launch plan"), JSON.stringify(listed));
  const nobody = (await api("GET", `/api/data/cards?areaId=${todo}&unassigned=true`)).body.cards.map((entry) => entry.name);
  check("and 'unassigned' means nobody at all", JSON.stringify(nobody) === JSON.stringify(["Free for the taking", "Nobody's card"]), JSON.stringify(nobody));
  const work = (await as(ben)("GET", "/api/data/my-work")).body;
  const workNames = JSON.stringify(work);
  check("a shared card is in My work for each person on it", workNames.includes("Launch plan"));
  await mine.goto(`${BASE}/board/${board.insertId}?assignee=${ben.id}`, { waitUntil: "networkidle" });
  await mine.waitForTimeout(1000);
  // Cards the filter leaves out are hidden rather than removed.
  const filtered = await mine.locator("[data-card-id]").evaluateAll((els) =>
    els.filter((el) => el.checkVisibility()).map((el) => el.querySelector("h3")?.textContent.trim()));
  check("the board filter shows it for either person", JSON.stringify(filtered) === JSON.stringify(["Launch plan"]), JSON.stringify(filtered));

  // --- Agents -------------------------------------------------------------------------
  console.log("\nagents claiming work");
  const keyFor = async (who) => (await (await fetch(`${BASE}/api/auth/api-key/create`, { method: "POST",
    headers: { "content-type": "application/json", cookie: who.cookie }, body: JSON.stringify({ name: "agent" }) })).json()).key;
  const toolAs = (key) => async (name, args) => {
    const res = await fetch(`${BASE}/mcp`, { method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
    const text = await res.text();
    const json = text.trim().startsWith("{") ? JSON.parse(text)
      : JSON.parse(text.split("\n").filter((l) => l.startsWith("data:")).pop().slice(5));
    if (json.error || json.result?.isError) throw new Error(`${name}: ${JSON.stringify(json.error ?? json.result)}`);
    return JSON.parse(json.result.content[0].text);
  };
  const agentA = toolAs(await keyFor(anna));
  const agentB = toolAs(await keyFor(ben));

  const race = await Promise.all([agentA("claimCard", { cardId: free }), agentB("claimCard", { cardId: free })]);
  const winners = race.filter((answer) => answer.claimed);
  check("two agents claiming the same free card at once: exactly one gets it", winners.length === 1 && (await onCard(free)).length === 1,
    JSON.stringify(race.map((answer) => answer.claimed)));
  const loser = race.find((answer) => !answer.claimed);
  check("and the other is told who holds it", loser?.heldBy?.userId === (await onCard(free))[0]);
  const taken = await agentA("claimCard", { cardId: shared });
  check("claiming a card you are already on succeeds, and adds nobody",
    taken.claimed === true && (await onCard(shared)).length === 2);
  const released = await agentB("releaseCard", { cardId: shared });
  check("releasing takes only yourself off", released.released && JSON.stringify(await onCard(shared)) === JSON.stringify([anna.id]));
  const updated = await agentA("updateCard", { cardId: nobodys, assigneeIds: [anna.id, owner.id] });
  check("an agent can put several people on a card", JSON.stringify(updated.card.assigneeIds) === JSON.stringify([anna.id, owner.id]) && updated.card.assigneeId === anna.id);
  let refused = false;
  try { await agentA("updateCard", { cardId: nobodys, assigneeIds: [stranger.id] }); } catch { refused = true; }
  check("but not somebody who is not on the board", refused);
  const found = await agentA("searchCards", { assigneeId: owner.id, done: false });
  check("searching by a person finds the cards they share", found.cards.some((entry) => entry.id === nobodys && entry.assignees.length === 2));
  const created = await agentA("createCard", { areaId: todo, name: "Pair on the release", assigneeIds: [anna.id, ben.id] });
  check("and create a card on two people", JSON.stringify(created.card.assigneeIds) === JSON.stringify([anna.id, ben.id]));

  // --- Leaving -----------------------------------------------------------------------
  console.log("\nwhen a person is deleted");
  await c.query("UPDATE `user` SET role = 'admin' WHERE id = ?", [owner.id]);
  const removed = await api("POST", "/api/auth/admin/delete", { userId: ben.id, reason: "Left the team" });
  const [[left]] = await c.query("SELECT COUNT(*) AS n FROM card_assignees WHERE user = ?", [ben.id]);
  check("their assignments go with them", removed.status === 200 && Number(left.n) === 0, `${removed.status}, ${left.n} left`);
} catch (error) {
  console.error(`\n FAIL  the run stopped early — ${error.message.split("\n")[0]}`);
  failures++;
} finally {
  await stop();
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures ? 1 : 0);
