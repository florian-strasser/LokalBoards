// A board drawn as a mind map.
//
// The board's title is the node in the middle, its areas branch off it and
// their cards branch off those — and all of it can be dragged anywhere. What
// this checks is the part that has to be true for that to be worth anything:
// that where you put a node is still where it is after a reload, that it is
// where your colleague sees it too without one, that dragging an area takes
// its cards with it, that dropping a card on another area is the same move as
// dragging it into another column, and — the point of a layout rather than a
// separate tool — that switching the board back to columns finds every card in
// its area, in order, with nothing lost.
//
// It also checks the two things a position endpoint can get wrong: a reader
// cannot move anything, and a member of one board cannot move a node on
// another by sending its id.
//
// And how the map sits on the page: it opens at its real size with the board's
// name in the middle, and it runs on behind the header and the board's title —
// so a card that has ended up behind them has to open and drag like any other,
// the empty canvas up there has to move the map, and the header's own controls
// have to go on working with the map behind them.
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
const DB = "lokalboards_mindmap";
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
  const stranger = await account("Mallory", "mallory@example.test");

  const api = async (who, method, path, body) => {
    const res = await fetch(BASE + path, {
      method, headers: { "content-type": "application/json", cookie: who.cookie },
      body: method === "GET" ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  const [board] = await c.execute("INSERT INTO boards (user, name, status, style) VALUES (?,?,?,?)",
    [owner.id, "Eventfalcon", "private", "mindmap"]);
  const boardId = board.insertId;
  await c.execute("INSERT INTO invitations (board, user, permission) VALUES (?,?,?)", [boardId, colleague.id, "edit"]);
  // Somebody else's board, to make sure its nodes cannot be moved from here.
  const [other] = await c.execute("INSERT INTO boards (user, name, status) VALUES (?,?,?)", [stranger.id, "Not yours", "private"]);
  const [otherArea] = await c.execute("INSERT INTO areas (board, name, sort) VALUES (?,?,?)", [other.insertId, "Theirs", 0]);

  const area = async (name, sort) =>
    (await c.execute("INSERT INTO areas (board, name, sort) VALUES (?,?,?)", [boardId, name, sort]))[0].insertId;
  const todo = await area("Todo", 0);
  const doing = await area("Doing", 1);
  const create = async (areaId, name) =>
    (await api(owner, "POST", "/api/data/card", { areaId, name, status: false })).body.card.id;
  const first = await create(todo, "Appgestaltung");
  const second = await create(todo, "Push-Benachrichtigungen");
  const third = await create(doing, "Startseite neu");
  await api(owner, "PUT", "/api/data/card", { cardID: first, name: "Appgestaltung", status: false,
    content: "- [x] Logo\n- [ ] Icons", assignees: [owner.id], dueDate: "2026-10-05T09:00:00Z" });

  browser = await chromium.launch();
  // The map opens at its real size, which on a board this spread out leaves
  // some of it outside the window. Everything here that is about dragging one
  // node to another wants all of it in reach, so it asks for the whole map the
  // way a person would; what the map looks like as it opens has a section of
  // its own further down.
  const settle = async (page, { whole = true } = {}) => {
    await page.waitForSelector(".mindmap-root", { timeout: 15000 });
    await page.waitForTimeout(1200);
    if (whole) {
      await page.getByRole("button", { name: "Fit to screen" }).click();
      await page.waitForTimeout(300);
    }
  };
  const open = async (who, { whole = true, viewport = { width: 1400, height: 1000 } } = {}) => {
    const context = await browser.newContext({ viewport });
    await context.addCookies([{ name: "session_token", value: who.token, domain: "127.0.0.1", path: "/" }]);
    const page = await context.newPage();
    await page.goto(`${BASE}/board/${boardId}`, { waitUntil: "domcontentloaded" });
    await settle(page, { whole });
    return page;
  };
  const mine = await open(owner);
  const theirs = await open(colleague);

  const box = async (page, selector) => {
    const at = await page.locator(selector).first().boundingBox();
    return at ? { x: at.x + at.width / 2, y: at.y + at.height / 2 } : null;
  };
  const cardNode = (id) => `.mindmap-card:has([data-card-id="${id}"])`;
  const areaNode = (id) => `.mindmap-area[data-area-id="${id}"]`;
  const areaName = (id) => `${areaNode(id)} input`;
  // Where a node sits on the plane, which is what is stored — as opposed to
  // where it happens to be on the screen, which depends on the pan and zoom.
  const planeAt = async (page, selector) =>
    page.locator(selector).first().evaluate((el) => ({
      x: parseFloat(el.style.left),
      y: parseFloat(el.style.top),
    }));
  const drag = async (page, selector, dx, dy, steps = 12) => {
    const from = await box(page, selector);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + dx, from.y + dy, { steps });
    await page.mouse.up();
    await page.waitForTimeout(900);
  };

  // --- It draws ---------------------------------------------------------------
  console.log("\nthe board as a map");
  check("the board's title is the node in the middle",
    (await mine.locator(".mindmap-root").textContent())?.trim() === "Eventfalcon");
  check("every area is a node", (await mine.locator(".mindmap-area").count()) === 2);
  check("and every card is one", (await mine.locator(".mindmap-card").count()) === 3);
  const firstText = (await mine.locator(cardNode(first)).first().innerText()).trim();
  check("a card on the map is its title — no status, people, checklist or date",
    firstText === "Appgestaltung", JSON.stringify(firstText));
  check("with a branch drawn to each of them",
    (await mine.locator(".mindmap-line").count()) === 5,
    `${await mine.locator(".mindmap-line").count()} lines`);
  const [[unplaced]] = await c.query("SELECT COUNT(*) AS n FROM cards WHERE mapX IS NOT NULL");
  check("nothing is written down until somebody drags something", Number(unplaced.n) === 0);

  // --- The buttons in the corner ----------------------------------------------
  // Pressed for real: panning captures the pointer, and once that swallowed
  // every click on them.
  console.log("\nthe buttons in the corner");
  const scale = async () => (await mine.locator(".mindmap-plane").evaluate(
    (el) => new DOMMatrix(getComputedStyle(el).transform).a));
  const zoomedOut = await scale();
  await mine.getByRole("button", { name: "Zoom in" }).click();
  await mine.waitForTimeout(300);
  check("zoom in zooms in", (await scale()) > zoomedOut * 1.1, `${zoomedOut} → ${await scale()}`);
  await mine.getByRole("button", { name: "Zoom out" }).click();
  await mine.waitForTimeout(300);
  check("zoom out zooms back out", Math.abs((await scale()) - zoomedOut) < 0.01);
  await mine.getByRole("button", { name: "Create new area" }).click();
  await mine.waitForTimeout(1200);
  const [[{ n: areasNow }]] = await c.query("SELECT COUNT(*) AS n FROM areas WHERE board = ? AND archivedAt IS NULL", [boardId]);
  check("create new area makes one", Number(areasNow) === 3, `${areasNow} areas`);
  check("and it is on the map straight away", (await mine.locator(".mindmap-area").count()) === 3);
  // Out of the way again, so the rest of this run sees the board it set up.
  const [[extra]] = await c.query("SELECT id FROM areas WHERE board = ? ORDER BY id DESC LIMIT 1", [boardId]);
  await c.query("UPDATE areas SET archivedAt = NOW() WHERE id = ?", [extra.id]);
  await mine.reload({ waitUntil: "domcontentloaded" });
  await settle(mine);

  // --- Dragging a card --------------------------------------------------------
  console.log("\ndragging a card");
  const before = await box(mine, cardNode(first));
  await drag(mine, cardNode(first), 260, -160);
  const [[moved]] = await c.query("SELECT mapX, mapY FROM cards WHERE id = ?", [first]);
  check("where it was put is stored", moved.mapX !== null && moved.mapY !== null,
    `${moved.mapX}, ${moved.mapY}`);
  const after = await box(mine, cardNode(first));
  check("and it is drawn there", after && Math.abs(after.x - before.x - 260) < 12 && Math.abs(after.y - before.y + 160) < 12,
    JSON.stringify({ dx: Math.round(after.x - before.x), dy: Math.round(after.y - before.y) }));
  // An open card puts itself in the address, which is how the board tells
  // whether one is open at all.
  check("the card did not open on the way", !mine.url().includes("card="), mine.url());
  check("the colleague sees it there too, without a reload",
    Math.abs((await box(theirs, cardNode(first))).x - after.x) < 12);

  await mine.reload({ waitUntil: "domcontentloaded" });
  await settle(mine);
  const reloaded = await planeAt(mine, cardNode(first));
  check("and it is still there after a reload",
    Math.round(reloaded.x) === Number(moved.mapX) && Math.round(reloaded.y) === Number(moved.mapY),
    JSON.stringify(reloaded));

  console.log("\npressing a card without moving it");
  await mine.locator(cardNode(third)).first().click();
  await mine.waitForTimeout(900);
  check("opens it, as a click on a tile does anywhere else", mine.url().includes(`card=${third}`), mine.url());
  await mine.keyboard.press("Escape");
  await mine.waitForTimeout(900);

  // --- Dragging an area -------------------------------------------------------
  console.log("\ndragging an area");
  // By its name, which is the hard part: the name is a text field, and the
  // whole area is meant to be what you take hold of.
  const cardBefore = await box(mine, cardNode(second));
  await drag(mine, areaName(todo), -180, 200);
  const [[areaAt]] = await c.query("SELECT mapX, mapY FROM areas WHERE id = ?", [todo]);
  check("the area's place is stored", areaAt.mapX !== null && areaAt.mapY !== null);
  const cardAfter = await box(mine, cardNode(second));
  check("its cards come with it — a branch moves as a branch",
    Math.abs(cardAfter.x - cardBefore.x + 180) < 14 && Math.abs(cardAfter.y - cardBefore.y - 200) < 14,
    JSON.stringify({ dx: Math.round(cardAfter.x - cardBefore.x), dy: Math.round(cardAfter.y - cardBefore.y) }));
  check("and taking hold of it by its name did not start renaming it",
    await mine.evaluate(() => document.activeElement?.tagName !== "INPUT"));

  console.log("\nclicking an area's name");
  await mine.locator(areaName(todo)).click();
  await mine.waitForTimeout(300);
  check("puts the caret in it, to rename it",
    await mine.evaluate((sel) => document.activeElement === document.querySelector(sel), areaName(todo)));
  await mine.keyboard.type(" & Design");
  await mine.keyboard.press("Tab");
  await mine.waitForTimeout(900);
  const [[renamed]] = await c.query("SELECT name, mapX, mapY FROM areas WHERE id = ?", [todo]);
  check("and the new name is saved", renamed.name === "Todo & Design", renamed.name);
  check("without the area moving", renamed.mapX === areaAt.mapX && renamed.mapY === areaAt.mapY);

  // --- Dropping a card on another area ---------------------------------------
  console.log("\ndropping a card on another area");
  const onto = await box(mine, areaNode(doing));
  const from = await box(mine, cardNode(second));
  await drag(mine, cardNode(second), onto.x - from.x, onto.y - from.y, 16);
  const [[joined]] = await c.query("SELECT area FROM cards WHERE id = ?", [second]);
  check("the card is in that area now", Number(joined.area) === doing, `area ${joined.area}`);
  const [[atEnd]] = await c.query(
    "SELECT id FROM cards WHERE area = ? AND archivedAt IS NULL ORDER BY sort DESC, id DESC LIMIT 1", [doing]);
  check("at the end of it, the way a column takes a card", Number(atEnd.id) === second);

  // --- The + on an area -------------------------------------------------------
  console.log("\nthe + on an area");
  const plus = `${areaNode(doing)} [data-testid="new-card-button"]`;
  const areaBox = await mine.locator(areaNode(doing)).boundingBox();
  const plusBox = await mine.locator(plus).boundingBox();
  check("sits on the area's bottom edge, in the middle",
    Math.abs(plusBox.y + plusBox.height / 2 - (areaBox.y + areaBox.height)) < 3 &&
    Math.abs(plusBox.x + plusBox.width / 2 - (areaBox.x + areaBox.width / 2)) < 3);
  await mine.locator(plus).click();
  await mine.locator(`${areaNode(doing)} [data-testid="new-card-input"]`).fill("Kontaktformular");
  await mine.locator(`${areaNode(doing)} [data-testid="new-card-submit"]`).click();
  await mine.waitForTimeout(1200);
  const [[made]] = await c.query("SELECT id, area FROM cards WHERE name = 'Kontaktformular'");
  check("makes a card in that area", made && Number(made.area) === doing, `area ${made?.area}`);
  check("and it is on the map straight away", (await mine.locator(cardNode(made?.id)).count()) === 1);

  // --- A reader ---------------------------------------------------------------
  console.log("\nsomebody who may only read");
  await c.query("UPDATE invitations SET permission = 'read' WHERE board = ? AND user = ?", [boardId, colleague.id]);
  await theirs.reload({ waitUntil: "domcontentloaded" });
  await settle(theirs);
  check("has no + to press", (await theirs.locator('[data-testid="new-card-button"]').count()) === 0);
  const heldBefore = await planeAt(theirs, cardNode(third));
  await drag(theirs, cardNode(third), 150, 90);
  const heldAfter = await planeAt(theirs, cardNode(third));
  check("cannot drag a card", heldBefore.x === heldAfter.x && heldBefore.y === heldAfter.y);
  await theirs.locator(cardNode(third)).first().click();
  await theirs.waitForTimeout(900);
  check("but opens one with a click", theirs.url().includes(`card=${third}`), theirs.url());

  // --- How it opens -----------------------------------------------------------
  console.log("\nopening the map");
  // The board's name somewhere other than the middle of the plane, so that
  // "centred on the board's name" cannot be true by accident.
  const ROOT = { x: 240, y: -130 };
  await api(owner, "POST", "/api/data/mindmap", { boardId, nodes: [{ kind: "board", id: boardId, ...ROOT }] });
  const fresh = await open(owner, { whole: false });
  const view = (page) => page.locator(".mindmap-plane").evaluate((el) => {
    const m = new DOMMatrix(getComputedStyle(el).transform);
    return { scale: m.a, x: m.e, y: m.f };
  });
  check("it is at its real size, not shrunk to fit", (await view(fresh)).scale === 1, String((await view(fresh)).scale));
  const pane = await fresh.locator(".mindmap-viewport").boundingBox();
  const middle = { x: pane.x + pane.width / 2, y: pane.y + pane.height / 2 };
  const name = await box(fresh, ".mindmap-root");
  check("with the board's name in the middle of it",
    Math.abs(name.x - middle.x) < 2 && Math.abs(name.y - middle.y) < 2,
    JSON.stringify({ name, middle }));
  await fresh.setViewportSize({ width: 1100, height: 760 });
  await fresh.waitForTimeout(400);
  const smaller = await fresh.locator(".mindmap-viewport").boundingBox();
  const nameNow = await box(fresh, ".mindmap-root");
  check("and it stays there when the window changes size",
    Math.abs(nameNow.x - (smaller.x + smaller.width / 2)) < 2 && Math.abs(nameNow.y - (smaller.y + smaller.height / 2)) < 2);
  await fresh.setViewportSize({ width: 1400, height: 1000 });
  await fresh.waitForTimeout(400);

  // --- Behind the title -------------------------------------------------------
  console.log("\na card that has ended up behind the board's title");
  // Level with the title, in the middle of the window: inside the title's row,
  // clear of the title itself and of the two buttons at the other end of it.
  const title = await fresh.locator("h1").boundingBox();
  const spot = { x: middle.x, y: Math.round(title.y + title.height / 2) };
  const at = { x: ROOT.x + Math.round(spot.x - middle.x), y: ROOT.y + Math.round(spot.y - middle.y) };
  await api(owner, "POST", "/api/data/mindmap", { boardId, nodes: [{ kind: "card", id: third, ...at }] });
  await fresh.reload({ waitUntil: "domcontentloaded" });
  await settle(fresh, { whole: false });
  const behind = await box(fresh, cardNode(third));
  check("is drawn there, with the row in front of it",
    Math.abs(behind.x - spot.x) < 3 && Math.abs(behind.y - spot.y) < 3 &&
    spot.y < pane.y, JSON.stringify({ behind, spot, paneTop: pane.y }));
  await fresh.mouse.click(spot.x, spot.y);
  await fresh.waitForTimeout(900);
  check("opens when it is pressed", fresh.url().includes(`card=${third}`), fresh.url());
  await fresh.keyboard.press("Escape");
  await fresh.waitForTimeout(900);
  await fresh.mouse.move(spot.x, spot.y);
  await fresh.mouse.down();
  await fresh.mouse.move(spot.x + 60, spot.y + 260, { steps: 12 });
  await fresh.mouse.up();
  await fresh.waitForTimeout(900);
  const [[pulled]] = await c.query("SELECT mapX, mapY, area FROM cards WHERE id = ?", [third]);
  check("and can be dragged out from under it",
    Number(pulled.mapX) === at.x + 60 && Number(pulled.mapY) === at.y + 260 && Number(pulled.area) === doing,
    JSON.stringify({ from: at, to: pulled }));

  console.log("\nthe empty canvas behind the title and the header");
  // Somewhere along the title's row with nothing of the row or the map under it.
  const clear = await fresh.evaluate(([x0, y]) => {
    for (let x = x0 + 150; x < x0 + 500; x += 25) {
      if (document.elementFromPoint(x, y)?.classList.contains("mindmap-viewport")) return x;
    }
    return null;
  }, [middle.x, spot.y]);
  check("is the map's, not the row's", clear !== null, String(clear));
  const held = await view(fresh);
  await fresh.mouse.move(clear, spot.y);
  await fresh.mouse.down();
  await fresh.mouse.move(clear - 150, spot.y + 90, { steps: 10 });
  await fresh.mouse.up();
  await fresh.waitForTimeout(300);
  const let_go = await view(fresh);
  check("dragging it moves the map", let_go.x - held.x === -150 && let_go.y - held.y === 90,
    JSON.stringify({ dx: let_go.x - held.x, dy: let_go.y - held.y }));
  await fresh.mouse.move(clear, spot.y);
  await fresh.mouse.wheel(0, 120);
  await fresh.waitForTimeout(300);
  check("and so does scrolling over it", (await view(fresh)).y - let_go.y === -120,
    String((await view(fresh)).y - let_go.y));

  console.log("\nthe header's own controls, with the map behind them");
  await fresh.locator("header input").first().click();
  check("the search field takes a click",
    await fresh.evaluate(() => document.activeElement?.tagName === "INPUT" && !!document.activeElement.closest("header")));
  await fresh.keyboard.press("Escape");
  const boardMenu = fresh.locator('button[aria-haspopup="menu"]').first();
  await boardMenu.click();
  await fresh.waitForTimeout(300);
  check("the board's menu opens", await fresh.getByRole("button", { name: "Export board" }).isVisible());
  // Closed the way it is closed: by pressing anywhere else.
  await fresh.mouse.click(40, 700);
  await fresh.waitForTimeout(300);
  // The filter's panel is put in <body>, like every popover.
  const panels = () => fresh.locator("body > .fixed.z-50").count();
  const closed = await panels();
  await fresh.getByRole("button", { name: "Filters" }).click();
  await fresh.waitForTimeout(300);
  check("and so does its filter", (await panels()) === closed + 1, `${closed} → ${await panels()}`);
  await fresh.keyboard.press("Escape");

  // --- A phone ----------------------------------------------------------------
  // The search dialog is the header's. When the header was lifted over the map
  // by a wrapper, the dialog was lifted no higher than the board's title, which
  // stayed on top of it — bright, and pressable through the backdrop.
  console.log("\nthe search dialog on a phone");
  const phone = await open(owner, { whole: false, viewport: { width: 390, height: 844 } });
  check("the map opens at its real size there too", (await view(phone)).scale === 1);
  const menuAt = await phone.locator('button[aria-haspopup="menu"]').first().boundingBox();
  await phone.locator('header button[aria-label="Search"]').click();
  await phone.waitForTimeout(900);
  const onTop = await phone.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    return { menu: !!el?.closest('button[aria-haspopup="menu"]'), dialog: !!el?.closest(".z-40") };
  }, [menuAt.x + menuAt.width / 2, menuAt.y + menuAt.height / 2]);
  check("covers the board's title and its buttons", onTop.dialog && !onTop.menu, JSON.stringify(onTop));

  // --- Back to columns --------------------------------------------------------
  console.log("\nswitching the board back to columns");
  await api(owner, "POST", "/api/data/board",
    { id: boardId, userId: owner.id, name: "Eventfalcon", style: "kanban", image: null, color: "", status: "private" });
  await mine.reload({ waitUntil: "domcontentloaded" });
  await mine.waitForTimeout(1500);
  check("the columns are back", (await mine.locator(".card-list").count()) === 2);
  const inTodo = await mine.locator(`[data-area-id="${todo}"] [data-card-id]`).evaluateAll(
    (els) => els.map((el) => el.getAttribute("data-card-id")));
  const inDoing = await mine.locator(`[data-area-id="${doing}"] [data-card-id]`).evaluateAll(
    (els) => els.map((el) => el.getAttribute("data-card-id")));
  check("every card is in its area, in order",
    JSON.stringify(inTodo) === JSON.stringify([String(first)]) &&
    JSON.stringify(inDoing) === JSON.stringify([String(third), String(second), String(made?.id)]),
    JSON.stringify({ inTodo, inDoing }));
  const [[kept]] = await c.query("SELECT mapX, mapY FROM cards WHERE id = ?", [first]);
  check("and the map is remembered for when it comes back", kept.mapX !== null);

  // --- Who may move things ----------------------------------------------------
  console.log("\nwho may move a node");
  await c.query("UPDATE invitations SET permission = 'read' WHERE board = ? AND user = ?", [boardId, colleague.id]);
  const readerTried = await api(colleague, "POST", "/api/data/mindmap",
    { boardId, nodes: [{ kind: "card", id: first, x: 5, y: 5 }] });
  check("somebody who may only read is refused", readerTried.status === 403, String(readerTried.status));
  const [[unchanged]] = await c.query("SELECT mapX FROM cards WHERE id = ?", [first]);
  check("and nothing moved", Number(unchanged.mapX) === Number(kept.mapX));

  const acrossBoards = await api(owner, "POST", "/api/data/mindmap",
    { boardId, nodes: [{ kind: "area", id: otherArea.insertId, x: 40, y: 40 }] });
  const [[theirArea]] = await c.query("SELECT mapX FROM areas WHERE id = ?", [otherArea.insertId]);
  check("a node on somebody else's board is not moved by sending its id",
    theirArea.mapX === null, `answered ${acrossBoards.status}, moved ${acrossBoards.body.moved}`);

  const nonsense = await api(owner, "POST", "/api/data/mindmap",
    { boardId, nodes: [{ kind: "card", id: first, x: "over there", y: null }] });
  const [[stillThere]] = await c.query("SELECT mapX FROM cards WHERE id = ?", [first]);
  check("and a coordinate that is not one is ignored rather than stored",
    Number(stillThere.mapX) === Number(kept.mapX), `answered ${nonsense.status}`);
} catch (error) {
  console.error(`\n FAIL  the run stopped early — ${error.message.split("\n")[0]}`);
  failures++;
} finally {
  await stop();
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures ? 1 : 0);
