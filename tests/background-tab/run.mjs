// A tab that is put in the background, and looked at again later.
//
// The app holds one connection for live updates. Left alone, a hidden tab kept
// it — or kept trying to: the browser throttles a page nobody is looking at
// until it cannot keep the heartbeat up, the connection is given up somewhere
// along the way, the client reconnects, and round it goes. Safari writes each
// of those into the console as a WebSocket that failed, and whoever came back
// to the tab found a column of them — and, if they had been away longer than
// the two minutes the server remembers, a board still showing what it had
// shown when they left.
//
// So this does what that person did. It hides a tab and checks that the
// connection is kept for a glance at another tab, hung up properly after a
// minute, and not retried while the tab stays hidden, even when it is the
// server that went away. Then it looks at the tab again and checks that it
// connects and catches up without a reload: the board, a card that was left
// open, the dashboard — and a board the account was taken off in the meantime,
// which has to stop showing rather than go on showing what it showed.
// A server restarting under a tab that *is* being looked at has to come out
// the same way, since nothing is replayed after that either.
//
// Last, the other end: the server renders these pages too, and used to open a
// connection of its own to nowhere when it did.
//
// "Hidden" is the page being told it is — `document.hidden` and the
// `visibilitychange` event — since a test cannot put a real tab behind another.
// What the browser then does to a hidden tab's timers is the part this cannot
// reach; the minute here is a real minute, on timers that run on time.
//
// Requires a built app (`npm run build`) and the credentials in `.env.local`.
// Creates and drops a database of its own. Takes a little over two minutes,
// one of them spent waiting out that minute.
import fs from "node:fs";
import { spawn } from "node:child_process";
import mysql from "mysql2/promise";
import { chromium } from "playwright";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const DB = "lokalboards_background";
const PORT = 3100, BASE = `http://127.0.0.1:${PORT}`;
const creds = { host: env.NUXT_MYSQL_HOST, user: env.NUXT_MYSQL_USER, password: env.NUXT_MYSQL_PASSWORD };
const GRACE = 60_000;

const admin = await mysql.createConnection(creds);
await admin.query(`DROP DATABASE IF EXISTS \`${DB}\``);
await admin.query(`CREATE DATABASE \`${DB}\``);
await admin.end();

// The server says what its own Socket.IO client is up to, so the run can see
// whether it has one (`DEBUG` is that library's switch, not the app's).
let child = null, serverSaid = "";
const startServer = async () => {
  child = spawn("node", [".output/server/index.mjs"], {
    env: { ...process.env, ...env, NUXT_MYSQL_DATABASE: DB, NUXT_MYSQL_SSL: "false",
           NUXT_PUBLIC_SIGNUP: "true", PORT: String(PORT), NITRO_PORT: String(PORT),
           NUXT_BOARDS_URL: BASE, NUXT_LOG_LEVEL: "error", NUXT_LANGUAGE: "en",
           DEBUG: "socket.io-client:manager" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => (serverSaid += chunk));
  child.stderr.on("data", (chunk) => (serverSaid += chunk));
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(BASE + "/api/health")).ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};
const stopServer = async () => {
  child?.kill("SIGKILL");
  child = null;
  await new Promise((r) => setTimeout(r, 700));
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  const api = async (who, method, path, body) => {
    const res = await fetch(BASE + path, {
      method, headers: { "content-type": "application/json", cookie: who.cookie },
      body: method === "GET" ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  const [board] = await c.execute("INSERT INTO boards (user, name, status) VALUES (?,?,?)", [owner.id, "Eventfalcon", "private"]);
  const boardId = board.insertId;
  await c.execute("INSERT INTO invitations (board, user, permission) VALUES (?,?,?)", [boardId, colleague.id, "edit"]);
  const [todoRow] = await c.execute("INSERT INTO areas (board, name, sort) VALUES (?,?,?)", [boardId, "Todo", 0]);
  const todo = todoRow.insertId;
  const create = async (who, name) =>
    (await api(who, "POST", "/api/data/card", { areaId: todo, name, status: false })).body.card.id;
  const first = await create(owner, "Appgestaltung");
  // Something made with an API key is announced to every open board by the
  // server; something made with a browser's session is announced by that
  // browser. This run has no second browser at work, so "live" is a key.
  const { key } = (await api(colleague, "POST", "/api/auth/api-key/create", { name: "background test" })).body;
  const createLive = async (name) => (await fetch(`${BASE}/api/data/card`, {
    method: "POST", headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify({ areaId: todo, name, status: false }) })).status;

  browser = await chromium.launch();
  // A page, and everything it does over the wire that this run cares about.
  const open = async (who, path) => {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await context.addCookies([{ name: "session_token", value: who.token, domain: "127.0.0.1", path: "/" }]);
    const page = await context.newPage();
    const wire = { sockets: [], requests: 0, errors: [] };
    page.on("websocket", (ws) => {
      const socket = { open: true, failed: false };
      wire.sockets.push(socket);
      ws.on("close", () => (socket.open = false));
      ws.on("socketerror", () => (socket.failed = true));
    });
    page.on("request", (request) => { if (request.url().includes("/socket.io/")) wire.requests++; });
    page.on("console", (message) => { if (message.type() === "error") wire.errors.push(message.text()); });
    await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    return { page, wire, live: () => wire.sockets.filter((socket) => socket.open).length };
  };
  const setHidden = (page, hidden) => page.evaluate((hidden) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
  const hide = (page) => setHidden(page, true);
  const lookAt = async (tab) => {
    await setHidden(tab.page, false);
    for (let i = 0; i < 40 && tab.live() === 0; i++) await sleep(250);
    await tab.page.waitForTimeout(1500);
  };
  const tile = (page, name) => page.locator("[data-card-id]", { hasText: name }).count();

  // --- Glancing away, and staying away ---------------------------------------
  console.log("\na board in a tab that is being looked at");
  const mine = await open(owner, `/board/${boardId}`);
  check("has one connection", mine.live() === 1, `${mine.live()} open`);

  console.log("\nglancing at another tab");
  await hide(mine.page);
  await sleep(5000);
  check("keeps it", mine.live() === 1 && mine.wire.sockets.length === 1);
  await setHidden(mine.page, false);
  await sleep(1000);
  check("and coming back opens nothing new", mine.wire.sockets.length === 1, `${mine.wire.sockets.length} sockets so far`);

  console.log(`\nleaving it in the background (waiting out the ${GRACE / 1000}s it is given)`);
  await hide(mine.page);
  await sleep(GRACE - 4000);
  check("the connection is still up just short of a minute", mine.live() === 1);
  await sleep(7000);
  check("and hung up after it", mine.live() === 0, `${mine.live()} open`);
  check("by the page, properly — nothing failed", mine.wire.sockets.every((socket) => !socket.failed));
  const requestsAtRest = mine.wire.requests;
  // The colleague carries on while nobody is looking at this tab.
  await create(colleague, "While you were out");
  await sleep(6000);
  check("it does not try to reconnect while it is hidden",
    mine.wire.requests === requestsAtRest && mine.live() === 0,
    `${mine.wire.requests - requestsAtRest} requests`);
  check("and the console has nothing in it", mine.wire.errors.length === 0, mine.wire.errors[0] ?? "");
  check("the tab knows nothing of the new card yet", (await tile(mine.page, "While you were out")) === 0);

  console.log("\nlooking at it again");
  await lookAt(mine);
  check("it connects", mine.live() === 1);
  check("and catches up without a reload", (await tile(mine.page, "While you were out")) === 1);
  // Live again from here: what happens next arrives on its own.
  const made = await createLive("And one more");
  await mine.page.waitForTimeout(1500);
  check("and is live again from there", (await tile(mine.page, "And one more")) === 1, `created: ${made}`);

  // --- The server going away under a hidden tab --------------------------------
  // The other way a hidden tab loses its connection: it is taken from it. That
  // was the start of the reconnecting that filled the console.
  console.log("\nthe server restarting while the tab is hidden");
  await mine.page.locator(`[data-card-id="${first}"]`).click();
  await mine.page.waitForTimeout(1200);
  check("(a card is open in it)", mine.page.url().includes(`card=${first}`));
  await hide(mine.page);
  await sleep(500);
  const requestsBefore = mine.wire.requests;
  await stopServer();
  // Things change while it is down, and after it is back.
  await c.query("INSERT INTO cards (area, name, content, status, sort) VALUES (?, 'Made while it was down', '', 0, 50)", [todo]);
  check("the server comes back", await startServer());
  await api(colleague, "POST", "/api/data/comment", { card: first, content: "Schau dir das bitte an." });
  await c.query("UPDATE cards SET content = 'Neu geschrieben, während du weg warst.' WHERE id = ?", [first]);
  await sleep(6000);
  check("the tab leaves it at that — no reconnecting from the background",
    mine.wire.requests === requestsBefore && mine.live() === 0,
    `${mine.wire.requests - requestsBefore} requests`);

  await lookAt(mine);
  check("looked at again, it connects", mine.live() === 1);
  check("the board has what was made in the meantime",
    (await tile(mine.page, "Made while it was down")) === 1);
  check("the open card has its new description",
    (await mine.page.locator(".card-modal").innerText()).includes("Neu geschrieben, während du weg warst."));
  check("and the comment written on it",
    (await mine.page.locator(".card-modal").innerText()).includes("Schau dir das bitte an."));
  await mine.page.keyboard.press("Escape");
  await mine.page.waitForTimeout(900);

  // --- The server going away under a tab that is being looked at ---------------
  console.log("\nthe server restarting under a tab that is being looked at");
  await stopServer();
  await c.query("INSERT INTO cards (area, name, content, status, sort) VALUES (?, 'Deployed over', '', 0, 60)", [todo]);
  await startServer();
  for (let i = 0; i < 60 && mine.live() === 0; i++) await sleep(250);
  await mine.page.waitForTimeout(2000);
  check("it reconnects by itself", mine.live() === 1);
  check("and catches up, since nothing is replayed after a restart",
    (await tile(mine.page, "Deployed over")) === 1);

  // --- The dashboard -----------------------------------------------------------
  console.log("\nthe dashboard in a hidden tab");
  const dash = await open(owner, "/dashboard");
  await hide(dash.page);
  await sleep(500);
  await stopServer();
  await startServer();
  await c.execute("INSERT INTO boards (user, name, status) VALUES (?,?,?)", [owner.id, "Started meanwhile", "private"]);
  await sleep(1500);
  check("does not show a board made in the meantime", (await dash.page.getByText("Started meanwhile").count()) === 0);
  await lookAt(dash);
  check("and does once it is looked at", (await dash.page.getByText("Started meanwhile").count()) > 0);

  // --- Taken off the board while away ------------------------------------------
  console.log("\nsomebody taken off the board while their tab was hidden");
  const theirs = await open(colleague, `/board/${boardId}`);
  check("(they see the board)", (await tile(theirs.page, "Appgestaltung")) === 1);
  await hide(theirs.page);
  await sleep(500);
  await stopServer();
  await c.query("DELETE FROM invitations WHERE board = ? AND user = ?", [boardId, colleague.id]);
  await startServer();
  await lookAt(theirs);
  // The server tells somebody without access to a private board that it does
  // not exist, and so does the page — which is what reloading it would say.
  check("is not shown the board as it was when they look again",
    (await tile(theirs.page, "Appgestaltung")) === 0);
  check("and is told what a reload would tell them, where they are",
    (await theirs.page.getByText("This board does not exist").count()) === 1 &&
    theirs.page.url().includes(`/board/${boardId}`), theirs.page.url());

  // --- The server's own end ------------------------------------------------------
  // Every page above was rendered by the server first, which loads the same
  // module that makes the browser's connection.
  console.log("\nthe server itself");
  const dialled = (serverSaid.match(/socket\.io-client:manager opening/g) ?? []).length;
  check("opens no connection of its own while rendering pages", dialled === 0, `${dialled} attempts`);
} catch (error) {
  console.error(`\n FAIL  the run stopped early — ${error.message.split("\n")[0]}`);
  failures++;
} finally {
  await stop();
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures ? 1 : 0);
