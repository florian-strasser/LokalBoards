// A repeating card: marked done, the next one is on the board.
//
// Set a card to repeat every week from the due-date menu, move it along to
// "Done" and tick it off there, and the next one has to appear back in the
// column the series was set up in — at the bottom, due at the next date in the
// series after today, with its checklist unticked and its labels and reminders
// carried over. The card that was done stays done and stops repeating, so
// ticking it off and on again cannot put a second one on the board. The
// colleague watching the board sees the new card without a reload, an
// assistant marking a card done through MCP gets the same, and clearing the due
// date stops the series.
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

  const api = async (method, path, body) => {
    const res = await fetch(BASE + (method === "GET" ? path : path), {
      method, headers: { "content-type": "application/json", cookie: owner.cookie },
      body: method === "GET" ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const getCard = async (id) => (await api("GET", `/api/data/card?cardID=${id}`)).body.card;

  const [board] = await c.execute("INSERT INTO boards (user, name, status) VALUES (?,?,?)", [owner.id, "Chores", "private"]);
  await c.execute("INSERT INTO invitations (board, user, permission) VALUES (?,?,?)", [board.insertId, colleague.id, "edit"]);
  const area = async (name, sort) =>
    (await c.execute("INSERT INTO areas (board, name, sort) VALUES (?,?,?)", [board.insertId, name, sort]))[0].insertId;
  const todo = await area("Todo", 0);
  const done = await area("Done", 1);
  const [label] = await c.execute("INSERT INTO labels (board, name, color, sort) VALUES (?,?,?,?)", [board.insertId, "Office", "#0066cc", 0]);

  const create = async (areaId, name) => (await api("POST", "/api/data/card", { areaId, name, status: false })).body.card.id;
  const other = await create(todo, "Something else");
  const weekly = await create(todo, "Weekly report");

  // Due last Monday at nine, so it is done late and the Monday that has
  // already gone by has to be skipped rather than made into an overdue card.
  const due = new Date();
  due.setHours(9, 0, 0, 0);
  do due.setDate(due.getDate() - 1); while (due.getDay() !== 1);
  await api("PUT", "/api/data/card", {
    cardID: weekly, name: "Weekly report", status: false,
    content: "Every Monday.\n\n- [x] collect the numbers\n- [ ] send it round",
    dueDate: due.toISOString(), reminders: [60], labelIds: [label.insertId],
  });
  const expected = new Date(due);
  do expected.setDate(expected.getDate() + 7); while (expected.getTime() <= Date.now());

  browser = await chromium.launch();
  const open = async (who, card) => {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    await context.addCookies([{ name: "session_token", value: who.token, domain: "127.0.0.1", path: "/" }]);
    const page = await context.newPage();
    await page.goto(`${BASE}/board/${board.insertId}${card ? `?card=${card}` : ""}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    return page;
  };
  const mine = await open(owner, weekly);
  const theirs = await open(colleague);

  // --- Setting it up ---------------------------------------------------------
  console.log("\nsetting a card to repeat");
  await mine.locator(".shadow-xl.rounded-lg button", { has: mine.locator("svg.lucide-clock") }).first().click();
  await mine.locator('select:has(option[value="week"])').selectOption("week");
  await mine.waitForTimeout(1200);
  const [[set]] = await c.query("SELECT repeatEvery, repeatArea FROM cards WHERE id = ?", [weekly]);
  check("the due-date menu sets it to repeat every week", set.repeatEvery === "week", String(set.repeatEvery));
  check("from the column it is in", Number(set.repeatArea) === todo, String(set.repeatArea));
  await mine.keyboard.press("Escape");
  await mine.keyboard.press("Escape");
  await mine.waitForTimeout(900);
  check("its tile says it repeats",
    (await mine.locator(`[data-card-id="${weekly}"] [aria-label="Repeats"]`).count()) === 1);

  // --- Done --------------------------------------------------------------------
  // Moved along to "Done" first, the way a kanban board is worked, and ticked
  // off there: the next one still belongs back in "Todo".
  console.log("\nmarking it done");
  await api("POST", "/api/data/cardMove", { cardId: weekly, fromAreaId: todo, toAreaId: done, newIndex: 0 });
  await mine.goto(`${BASE}/board/${board.insertId}?card=${weekly}`, { waitUntil: "networkidle" });
  await mine.waitForTimeout(1200);
  await mine.locator('button[aria-label="Done"][aria-pressed="false"]').first().click();
  const toast = await mine.getByText("The next one is on the board").first().waitFor({ timeout: 5000 }).then(() => true, () => false);
  check("a toast says the next one is on the board", toast);

  const [cards] = await c.query("SELECT id, area, status, repeatEvery FROM cards WHERE name = 'Weekly report' ORDER BY id");
  check("there are now two of them", cards.length === 2, String(cards.length));
  const next = cards[1];
  const nextCard = await getCard(next?.id);
  check("the next one is back in the column the series was set up in", Number(next?.area) === todo, `area ${next?.area}`);
  const [[{ last }]] = await c.query("SELECT id AS last FROM cards WHERE area = ? AND archivedAt IS NULL ORDER BY sort DESC, id DESC LIMIT 1", [todo]);
  check("at the bottom of it", Number(last) === Number(next?.id));
  check("open, and still repeating", !next?.status && next?.repeatEvery === "week");
  check("due at the next Monday after today, at nine",
    new Date(nextCard?.dueDate).getTime() === expected.getTime(), `${nextCard?.dueDate} vs ${expected.toISOString()}`);
  check("with its checklist unticked",
    nextCard?.content === "Every Monday.\n\n- [ ] collect the numbers\n- [ ] send it round", JSON.stringify(nextCard?.content));
  check("and its label and reminder carried over",
    nextCard?.labels?.[0]?.name === "Office" && JSON.stringify(nextCard?.reminders) === "[60]",
    JSON.stringify([nextCard?.labels, nextCard?.reminders]));
  check("the one that was done stays done, in Done, and no longer repeats",
    cards[0].status === 1 && Number(cards[0].area) === done && cards[0].repeatEvery === null);

  await mine.waitForTimeout(800);
  check("the new card is on the board for the person who ticked it",
    (await mine.locator(`[data-card-id="${next?.id}"]`).count()) > 0);
  check("and for the colleague, without a reload",
    (await theirs.locator(`[data-card-id="${next?.id}"]`).count()) > 0);
  const history = await c.query("SELECT type, data FROM card_activity WHERE card IN (?, ?) ORDER BY id", [weekly, next?.id]);
  check("both cards say what happened in their history",
    history[0].some((row) => row.type === "repeated") && history[0].some((row) => row.type === "created" && String(row.data).includes("repeatedFrom")));

  // --- No second one ---------------------------------------------------------------
  console.log("\nticking the done card off and on again");
  await mine.locator('button[aria-label="Done"][aria-pressed="true"]').first().click();
  await mine.waitForTimeout(900);
  await mine.locator('button[aria-label="Done"][aria-pressed="false"]').first().click();
  await mine.waitForTimeout(1200);
  const [[{ n }]] = await c.query("SELECT COUNT(*) AS n FROM cards WHERE name = 'Weekly report'");
  check("does not put another one on the board", Number(n) === 2, `${n} cards`);

  // --- Through MCP -----------------------------------------------------------------
  console.log("\nan assistant marking it done");
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
  const answer = await tool("updateCard", { cardId: next.id, done: true });
  const weekAfter = new Date(expected);
  weekAfter.setDate(weekAfter.getDate() + 7);
  check("gets the next one back as `next`",
    answer.next && new Date(answer.next.dueDate).getTime() === weekAfter.getTime() && answer.next.repeat === "week",
    JSON.stringify(answer.next));
  check("and the card it finished no longer repeats", answer.card.repeat === null);
  const created = await tool("createCard", { areaId: todo, name: "Monthly invoices", dueDate: "2026-01-31T09:00:00Z", repeat: "month" });
  check("an assistant can create a repeating card", created.card.repeat === "month");
  let refused = false;
  try { await tool("createCard", { areaId: todo, name: "No date", repeat: "week" }); } catch { refused = true; }
  check("but not one without a due date", refused);

  // --- Stopping it ---------------------------------------------------------------------
  console.log("\nstopping a series");
  const third = answer.next.id;
  await api("PUT", "/api/data/card", { cardID: third, name: "Weekly report", status: false, dueDate: null });
  const [[stopped]] = await c.query("SELECT repeatEvery FROM cards WHERE id = ?", [third]);
  check("clearing the due date stops it repeating", stopped.repeatEvery === null);
  const bad = await api("PUT", "/api/data/card", { cardID: third, name: "Weekly report", status: false, repeatEvery: "hourly" });
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
