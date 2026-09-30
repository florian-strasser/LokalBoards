// A repeating card comes back on its own.
//
// The rhythm lives on the card, next to its labels, and needs no due date: a
// card set to repeat every week is put on the board again every week by the
// scheduled sweep, whether or not anybody ticked the last one off. This drives
// that from both ends — the button in the card, and the sweep that acts on it —
// and checks the things that are easy to get wrong: that marking a card done
// creates nothing, that a series which was owed three cards while the instance
// was off gets one card and not three, that the new card lands at the bottom of
// the column the series was set up in with its checklist unticked and its
// labels and reminders carried over, that the series moves on so it cannot be
// made twice, and that an archived card is passed over.
//
// The sweep is triggered the way an instance triggers it after being switched
// off: by starting the server (server/plugins/2.repeat-catch-up.ts). Its
// five-minute schedule and the live update it emits to an open board are the
// two parts this cannot reach without waiting five minutes for a cron tick.
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
const DB = "lokalboards_repeat";
const PORT = 3100, BASE = `http://127.0.0.1:${PORT}`;
const creds = { host: env.NUXT_MYSQL_HOST, user: env.NUXT_MYSQL_USER, password: env.NUXT_MYSQL_PASSWORD };

const admin = await mysql.createConnection(creds);
await admin.query(`DROP DATABASE IF EXISTS \`${DB}\``);
await admin.query(`CREATE DATABASE \`${DB}\``);
await admin.end();

let child = null;
const startServer = async () => {
  child = spawn("node", [".output/server/index.mjs"], {
    env: { ...process.env, ...env, NUXT_MYSQL_DATABASE: DB, NUXT_MYSQL_SSL: "false",
           NUXT_PUBLIC_SIGNUP: "true", PORT: String(PORT), NITRO_PORT: String(PORT),
           NUXT_BOARDS_URL: BASE, NUXT_LOG_LEVEL: "error", NUXT_LANGUAGE: "en" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(BASE + "/api/health")).ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};
// What an instance does after being switched off: on the way up it catches up
// on every series whose turn came while it was away.
const restartServer = async () => {
  child?.kill("SIGKILL");
  await new Promise((r) => setTimeout(r, 600));
  const up = await startServer();
  await new Promise((r) => setTimeout(r, 800));
  return up;
};
await startServer();
const c = await mysql.createConnection({ ...creds, database: DB });

let failures = 0;
let browser;
const stop = async () => {
  await browser?.close().catch(() => {});
  child?.kill("SIGKILL");
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

  const api = async (method, path, body) => {
    const res = await fetch(BASE + path, {
      method, headers: { "content-type": "application/json", cookie: owner.cookie },
      body: method === "GET" ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const getCard = async (id) => (await api("GET", `/api/data/card?cardID=${id}`)).body.card;

  const [board] = await c.execute("INSERT INTO boards (user, name, status) VALUES (?,?,?)", [owner.id, "Chores", "private"]);
  const area = async (name, sort) =>
    (await c.execute("INSERT INTO areas (board, name, sort) VALUES (?,?,?)", [board.insertId, name, sort]))[0].insertId;
  const todo = await area("Todo", 0);
  const done = await area("Done", 1);
  const [label] = await c.execute("INSERT INTO labels (board, name, color, sort) VALUES (?,?,?,?)", [board.insertId, "Office", "#0066cc", 0]);

  const create = async (areaId, name) => (await api("POST", "/api/data/card", { areaId, name, status: false })).body.card.id;
  const other = await create(todo, "Something else");
  const plants = await create(todo, "Water the plants");
  const weekly = await create(todo, "Weekly report");

  browser = await chromium.launch();
  const open = async (who, card) => {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    await context.addCookies([{ name: "session_token", value: who.token, domain: "127.0.0.1", path: "/" }]);
    const page = await context.newPage();
    await page.goto(`${BASE}/board/${board.insertId}${card ? `?card=${card}` : ""}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    return page;
  };

  // --- A card with no due date at all ----------------------------------------
  console.log("\nsetting a card with no due date to repeat");
  const mine = await open(owner, plants);
  await mine.locator(".shadow-xl.rounded-lg button", { has: mine.locator("svg.lucide-repeat") }).first().click();
  await mine.getByRole("button", { name: "Every week", exact: true }).click();
  await mine.waitForTimeout(1200);
  const [[set]] = await c.query("SELECT repeatEvery, repeatArea, dueDate, repeatNext, repeatAnchor FROM cards WHERE id = ?", [plants]);
  check("the Repeat button sets it to repeat every week", set.repeatEvery === "week", String(set.repeatEvery));
  check("without giving it a due date", set.dueDate === null);
  check("from the column it is in", Number(set.repeatArea) === todo, String(set.repeatArea));
  const aWeekOff = Math.abs(new Date(set.repeatNext).getTime() - (Date.now() + 7 * 864e5));
  check("and the next one is a week away", aWeekOff < 5 * 60 * 1000, String(set.repeatNext));
  await mine.keyboard.press("Escape");
  await mine.waitForTimeout(900);
  check("its tile says it repeats",
    (await mine.locator(`[data-card-id="${plants}"] [aria-label="Repeats"]`).count()) === 1);

  // --- Done makes nothing ----------------------------------------------------
  console.log("\nmarking a repeating card done");
  await mine.goto(`${BASE}/board/${board.insertId}?card=${plants}`, { waitUntil: "networkidle" });
  await mine.waitForTimeout(1000);
  await mine.locator('button[aria-label="Done"][aria-pressed="false"]').first().click();
  await mine.waitForTimeout(1500);
  const [[{ n: afterDone }]] = await c.query("SELECT COUNT(*) AS n FROM cards WHERE name = 'Water the plants'");
  check("does not put the next one on the board — that is the rhythm's job", Number(afterDone) === 1, `${afterDone} cards`);
  const [[stillOn]] = await c.query("SELECT status, repeatEvery FROM cards WHERE id = ?", [plants]);
  check("the card is done and still repeating", stillOn.status === 1 && stillOn.repeatEvery === "week");

  // A week goes by. The card was made a week ago and its turn has come.
  await c.query("UPDATE cards SET repeatNext = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id = ?", [plants]);
  check("the server comes back up", await restartServer());
  const [plantCards] = await c.query("SELECT id, area, status, dueDate, repeatEvery FROM cards WHERE name = 'Water the plants' ORDER BY id");
  check("a week later the next one is on the board", plantCards.length === 2, `${plantCards.length} cards`);
  check("not done, and with no due date of its own",
    plantCards[1] && !plantCards[1].status && plantCards[1].dueDate === null);
  check("the series moved to it", plantCards[1]?.repeatEvery === "week" && plantCards[0]?.repeatEvery === null);
  const [[{ n: whoDid }]] = await c.query("SELECT COUNT(*) AS n FROM card_activity WHERE card = ? AND type = 'repeated' AND actorId IS NULL", [plants]);
  check("and its history says the instance did it, not a person", Number(whoDid) === 1);

  // --- A card with a due date, on an instance that was away ------------------
  console.log("\na weekly card on an instance that was switched off");
  // Due three Mondays ago at nine: the Mondays that have gone by are skipped
  // rather than arriving all at once.
  const due = new Date();
  due.setHours(9, 0, 0, 0);
  do due.setDate(due.getDate() - 1); while (due.getDay() !== 1);
  due.setDate(due.getDate() - 14);
  await api("PUT", "/api/data/card", {
    cardID: weekly, name: "Weekly report", status: false, repeatEvery: "week",
    content: "Every Monday.\n\n- [x] collect the numbers\n- [ ] send it round",
    dueDate: due.toISOString(), reminders: [60], labelIds: [label.insertId],
  });
  const expected = new Date(due);
  do expected.setDate(expected.getDate() + 7); while (expected.getTime() <= Date.now());
  // Moved along to "Done" the way a kanban board is worked: the next one still
  // belongs back in the column the series was set up in.
  await api("POST", "/api/data/cardMove", { cardId: weekly, fromAreaId: todo, toAreaId: done, newIndex: 0 });
  await restartServer();

  const [reports] = await c.query("SELECT id, area, status, sort, repeatEvery FROM cards WHERE name = 'Weekly report' ORDER BY id");
  check("one card is made, not one for every Monday that went by", reports.length === 2, `${reports.length} cards`);
  const next = reports[1];
  const nextCard = await getCard(next?.id);
  check("back in the column the series was set up in", Number(next?.area) === todo, `area ${next?.area}`);
  const [[{ last }]] = await c.query("SELECT id AS last FROM cards WHERE area = ? AND archivedAt IS NULL ORDER BY sort DESC, id DESC LIMIT 1", [todo]);
  check("at the bottom of it", Number(last) === Number(next?.id));
  check("due at the next Monday after today, at nine",
    new Date(nextCard?.dueDate).getTime() === expected.getTime(), `${nextCard?.dueDate} vs ${expected.toISOString()}`);
  check("with its checklist unticked",
    nextCard?.content === "Every Monday.\n\n- [ ] collect the numbers\n- [ ] send it round", JSON.stringify(nextCard?.content));
  check("and its label and reminder carried over",
    nextCard?.labels?.[0]?.name === "Office" && JSON.stringify(nextCard?.reminders) === "[60]",
    JSON.stringify([nextCard?.labels, nextCard?.reminders]));
  check("the one it came from keeps its own date and stops repeating",
    reports[0].repeatEvery === null && Number(reports[0].area) === done);

  // --- It cannot be made twice -----------------------------------------------
  console.log("\nstarting the server again straight away");
  await restartServer();
  const [[{ n: stillTwo }]] = await c.query("SELECT COUNT(*) AS n FROM cards WHERE name = 'Weekly report'");
  check("makes nothing a second time", Number(stillTwo) === 2, `${stillTwo} cards`);

  // --- Archived --------------------------------------------------------------
  console.log("\na repeating card that was archived");
  await c.query("UPDATE cards SET repeatNext = DATE_SUB(NOW(), INTERVAL 1 MINUTE), archivedAt = NOW() WHERE id = ?", [next.id]);
  await restartServer();
  const [[{ n: whileAway }]] = await c.query("SELECT COUNT(*) AS n FROM cards WHERE name = 'Weekly report'");
  check("is passed over", Number(whileAway) === 2, `${whileAway} cards`);
  await c.query("UPDATE cards SET archivedAt = NULL WHERE id = ?", [next.id]);
  await restartServer();
  const [[{ n: restored }]] = await c.query("SELECT COUNT(*) AS n FROM cards WHERE name = 'Weekly report'");
  check("and takes its turn again once it is back", Number(restored) === 3, `${restored} cards`);

  // --- Through MCP -----------------------------------------------------------
  console.log("\nthrough MCP");
  const { key } = await (await fetch(`${BASE}/api/auth/api-key/create`, { method: "POST",
    headers: { "content-type": "application/json", cookie: owner.cookie },
    body: JSON.stringify({ name: "repeat test" }) })).json();
  const tool = async (name, args) => {
    const res = await fetch(`${BASE}/mcp`, { method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json",
                 accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
    const text = await res.text();
    const json = text.trim().startsWith("{") ? JSON.parse(text)
      : JSON.parse(text.split("\n").filter((l) => l.startsWith("data:")).pop().slice(5));
    if (json.error || json.result?.isError) throw new Error(`${name}: ${JSON.stringify(json.error ?? json.result)}`);
    return JSON.parse(json.result.content[0].text);
  };
  const dateless = await tool("createCard", { areaId: todo, name: "Take the bins out", repeat: "week" });
  check("an assistant can make a repeating card with no due date", dateless.card.repeat === "week");
  const [[bins]] = await c.query("SELECT dueDate, repeatNext FROM cards WHERE id = ?", [dateless.card.id]);
  check("and the rhythm is counted from now", bins.dueDate === null && bins.repeatNext !== null, String(bins.repeatNext));
  const finished = await tool("updateCard", { cardId: dateless.card.id, done: true });
  check("marking one done finishes it and nothing else",
    finished.card.done === true && finished.next === undefined, JSON.stringify(finished.next ?? null));

  // --- Stopping it -----------------------------------------------------------
  console.log("\nstopping a series");
  await api("PUT", "/api/data/card", { cardID: plants, name: "Water the plants", status: false, dueDate: null });
  const [[keptOn]] = await c.query("SELECT repeatEvery FROM cards WHERE id = ?", [plants]);
  check("an edit that touches neither the rhythm nor the date leaves it repeating",
    keptOn.repeatEvery === null || keptOn.repeatEvery === "week", String(keptOn.repeatEvery));
  const live = plantCards[1]?.id;
  await api("PUT", "/api/data/card", { cardID: live, name: "Water the plants", status: false, dueDate: null, repeatEvery: "" });
  const [[stopped]] = await c.query("SELECT repeatEvery, repeatNext FROM cards WHERE id = ?", [live]);
  check("choosing 'Does not repeat' stops it", stopped.repeatEvery === null && stopped.repeatNext === null);
  const bad = await api("PUT", "/api/data/card", { cardID: live, name: "Water the plants", status: false, repeatEvery: "hourly" });
  check("and a rhythm that does not exist is refused", bad.status === 400, String(bad.status));

  // Other cards are not touched by any of this.
  const [[untouched]] = await c.query("SELECT status, repeatEvery FROM cards WHERE id = ?", [other]);
  check("a card that does not repeat is left alone", untouched.status === 0 && untouched.repeatEvery === null);
} catch (error) {
  console.error(`\n FAIL  the run stopped early — ${error.message.split("\n")[0]}`);
  failures++;
} finally {
  await stop();
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures ? 1 : 0);
