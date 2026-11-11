// The REST API and the MCP server, held to each other and to the app.
//
// The two are separate ways in to the same boards, and for a long time each
// carried its own copy of every operation. The copies drifted: MCP wrote
// notifications the bell could not read, and the REST API sent changes made
// with a key to a socket room nobody was in. These checks are what keeps them
// together — each one does a thing through one surface and looks at what came
// of it, in the database or in a browser that has the board open.
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
const DB = "lokalboards_apimcp";
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
const c = await mysql.createConnection({ ...creds, database: DB, timezone: "Z" });
await c.query("SET time_zone = '+00:00'");
for (let i = 0; i < 200; i++) {
  const [r] = await c.query("SELECT 1 FROM `migrations` WHERE `id` LIKE '0036%'").catch(() => [[]]);
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
    const key = async (readOnly = false) => (await (await fetch(`${BASE}/api/auth/api-key/create`, { method: "POST",
      headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ name: readOnly ? "reader" : "agent", readOnly }) })).json()).key;
    return { id: row.id, cookie, token: cookie.split("=").slice(1).join("="), key };
  };
  const owner = await account("Florian", "owner@example.test");
  const anna = await account("Anna", "anna@example.test");
  const ownerKey = await owner.key();
  const readerKey = await owner.key(true);

  // REST with a key, the way an integration calls it.
  const rest = async (key, method, path, body) => {
    const res = await fetch(`${BASE}${path}`, { method,
      headers: { "x-api-key": key, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, body: json ?? text };
  };
  // An MCP tool, the way an agent calls it.
  const mcp = async (key, name, args) => {
    const res = await fetch(`${BASE}/mcp`, { method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
    const text = await res.text();
    const json = text.trim().startsWith("{") ? JSON.parse(text)
      : JSON.parse(text.split("\n").filter((l) => l.startsWith("data:")).pop().slice(5));
    if (json.error || json.result?.isError) throw new Error(`${name}: ${JSON.stringify(json.error ?? json.result)}`);
    return JSON.parse(json.result.content[0].text);
  };

  const board = async (name) => {
    const [b] = await c.execute("INSERT INTO boards (user, name, status) VALUES (?,?,?)", [owner.id, name, "private"]);
    await c.execute("INSERT INTO invitations (board, user, permission) VALUES (?,?,?)", [b.insertId, anna.id, "edit"]);
    const todo = (await c.execute("INSERT INTO areas (board, name, sort) VALUES (?,?,0)", [b.insertId, "Todo"]))[0].insertId;
    const done = (await c.execute("INSERT INTO areas (board, name, sort) VALUES (?,?,1)", [b.insertId, "Done"]))[0].insertId;
    return { id: b.insertId, todo, done };
  };
  const card = async (areaId, name) =>
    (await c.execute("INSERT INTO cards (area, name, sort) VALUES (?,?,0)", [areaId, name]))[0].insertId;
  const annasNewest = async () => {
    const [[row]] = await c.query("SELECT type, message FROM notifications WHERE userId = ? ORDER BY id DESC LIMIT 1", [anna.id]);
    return row;
  };

  // ------------------------------------------------- files and keys ----
  console.log("\nfiles and keys");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  const upload = async (key) => {
    const form = new FormData();
    form.append("image", new Blob([png], { type: "image/png" }), "dot.png");
    const res = await fetch(`${BASE}/api/upload/image`, { method: "POST", headers: { "x-api-key": key }, body: form });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const refused = await upload(readerKey);
  check("a read-only key cannot upload", refused.status === 403, String(refused.status));
  const uploaded = await upload(ownerKey);
  check("a full key can", uploaded.status === 200 && !!uploaded.body?.imageUrl, String(uploaded.status));

  const files = await board("Files");
  const withFiles = await card(files.todo, "Two files");
  const file = (n) => ({ filename: `dot${n}.png`, filetype: "image/png", filesize: png.length, filedata: uploaded.body.imageUrl });
  const put = await rest(ownerKey, "PUT", "/api/data/card", { cardID: withFiles, name: "Two files", content: "", status: false, files: [file(1), file(2)] });
  check("two files saved at once both come back", put.status === 200 && put.body?.attachments?.length === 2, JSON.stringify(put.body?.attachments?.map((a) => a.filename)));

  // ------------------------------------------- what MCP tells people ----
  console.log("\nwhat MCP tells people");
  const told = await board("Told");
  const toldCard = await card(told.todo, "Ship it");
  await mcp(ownerKey, "updateCard", { cardId: toldCard, done: true });
  const doneNote = await annasNewest();
  check("a card done through MCP reads like one done in the app", doneNote?.type === "card_status_changed" && doneNote.message === 'Card "Ship it" status changed to completed', doneNote?.message);
  await mcp(ownerKey, "writeComment", { cardId: toldCard, content: "All **green**" });
  const commentNote = await annasNewest();
  check("a comment through MCP carries what was said", commentNote?.type === "comment" && commentNote.message === 'New comment by "Florian" on card "Ship it": All **green**', commentNote?.message);
  await mcp(ownerKey, "createCard", { areaId: told.todo, name: "Next one" });
  const createdNote = await annasNewest();
  check("a card made through MCP reads like one made in the app", createdNote?.type === "card_created" && createdNote.message === '"Florian" created a new card "Next one" on board "Told"', createdNote?.message);
  await mcp(ownerKey, "moveCard", { cardId: toldCard, toAreaId: told.done });
  const movedNote = await annasNewest();
  check("a move through MCP too", movedNote?.type === "card_moved" && movedNote.message === 'Card "Ship it" moved from "Todo" to "Done"', movedNote?.message);

  // -------------------------------------------- ticks in a comment ----
  console.log("\nticks in a comment");
  const [listed] = await c.execute("INSERT INTO comments (card, user, content) VALUES (?,?,?)", [toldCard, anna.id, "- [ ] one\n- [ ] two"]);
  const tick = (content) => rest(ownerKey, "PATCH", "/api/data/comment", { id: listed.insertId, cardId: toldCard, content });
  const ticked = await tick("- [x] one\n- [ ] two");
  check("a box in somebody else's comment can be ticked", ticked.status === 200, JSON.stringify(ticked.body));
  const reworded = await tick("- [x] one\n- [ ] three");
  check("but nothing else in it changed", reworded.status === 400, String(reworded.status));

  // ------------------------------------------------------------ areas ----
  console.log("\nareas, either way");
  const areas = await board("Areas");
  const areaList = async () => (await rest(ownerKey, "GET", `/api/data/areas?boardId=${areas.id}`)).body.areas.map((a) => a.name);
  const viaRest = (await rest(ownerKey, "POST", "/api/data/area", { boardId: areas.id, name: "From REST" })).body.area;
  const viaMcp = (await mcp(ownerKey, "createArea", { boardId: areas.id, name: "From MCP" })).area;
  check("an area made either way goes at the end", JSON.stringify(await areaList()) === JSON.stringify(["Todo", "Done", "From REST", "From MCP"]), JSON.stringify(await areaList()));
  await mcp(ownerKey, "updateArea", { areaId: viaRest.id, name: "Renamed by MCP" });
  await rest(ownerKey, "POST", "/api/data/area", { boardId: areas.id, id: viaMcp.id, name: "Renamed by REST" });
  check("and renamed either way", JSON.stringify(await areaList()) === JSON.stringify(["Todo", "Done", "Renamed by MCP", "Renamed by REST"]), JSON.stringify(await areaList()));

  const other = await board("Other");
  const foreign = [viaMcp.id, other.todo, areas.todo, areas.done, viaRest.id];
  let mcpRefused = false;
  try { await mcp(ownerKey, "moveAreas", { boardId: areas.id, areaIds: foreign }); } catch { mcpRefused = true; }
  const restRefused = await rest(ownerKey, "PATCH", "/api/data/board", { boardId: areas.id, areas: foreign.map((id) => ({ id })) });
  check("an order with another board's area in it is refused either way, and changes nothing",
    mcpRefused && restRefused.status === 404 && JSON.stringify(await areaList()) === JSON.stringify(["Todo", "Done", "Renamed by MCP", "Renamed by REST"]),
    `${restRefused.status} ${JSON.stringify(await areaList())}`);
  await mcp(ownerKey, "moveAreas", { boardId: areas.id, areaIds: [viaMcp.id, viaRest.id, areas.todo, areas.done] });
  check("a proper order is taken", JSON.stringify(await areaList()) === JSON.stringify(["Renamed by REST", "Renamed by MCP", "Todo", "Done"]), JSON.stringify(await areaList()));

  const keep = await card(viaRest.id, "Kept in the archive");
  const archived = await mcp(ownerKey, "deleteArea", { areaId: viaRest.id });
  await rest(ownerKey, "DELETE", `/api/data/area?id=${viaMcp.id}&boardId=${areas.id}`);
  const [[mcpArea]] = await c.query("SELECT archivedAt FROM areas WHERE id = ?", [viaRest.id]);
  const [[restArea]] = await c.query("SELECT archivedAt FROM areas WHERE id = ?", [viaMcp.id]);
  const [[kept]] = await c.query("SELECT COUNT(*) AS n FROM cards WHERE id = ? AND archivedAt IS NULL", [keep]);
  check("deleting an area archives it either way, cards and all, as the app does",
    archived.archived === true && !!mcpArea?.archivedAt && !!restArea?.archivedAt && kept.n === 1 && JSON.stringify(await areaList()) === JSON.stringify(["Todo", "Done"]),
    JSON.stringify({ archived, mcp: !!mcpArea?.archivedAt, rest: !!restArea?.archivedAt, kept: kept.n }));

  // ------------------------------------------------------------ cards ----
  console.log("\ncards, either way");
  const cards = await board("Cards");
  const history = async (cardId) => (await c.query("SELECT type FROM card_activity WHERE card = ? ORDER BY id", [cardId]))[0].map((r) => r.type);

  const made = (await mcp(ownerKey, "createCard", { areaId: cards.todo, name: "Made by an agent" })).card;
  const madeRest = (await rest(ownerKey, "POST", "/api/data/card", { areaId: cards.todo, name: "Made with a key" })).body.card;
  check("a card made either way has its history", JSON.stringify(await history(made.id)) === '["created"]' && JSON.stringify(await history(madeRest.id)) === '["created"]',
    JSON.stringify([await history(made.id), await history(madeRest.id)]));

  await mcp(ownerKey, "updateCard", { cardId: made.id, done: true, dueDate: "2030-01-02T10:00:00.000Z", assigneeIds: [anna.id] });
  const changed = await history(made.id);
  check("a change through MCP goes in the history like one in the app",
    ["status", "due", "assigned"].every((type) => changed.includes(type)), JSON.stringify(changed));
  const [[assignedNote]] = await c.query("SELECT message FROM notifications WHERE userId = ? AND type = 'card_assigned' ORDER BY id DESC LIMIT 1", [anna.id]);
  check("and somebody an agent puts on a card is told", assignedNote?.message === '"Florian" assigned you the card "Made by an agent"', assignedNote?.message);

  // Positions count the cards the board shows: an archived one in between is stepped over.
  const first = await card(cards.done, "First");
  const hidden = await card(cards.done, "Archived in between");
  const last = await card(cards.done, "Last");
  await c.query("UPDATE cards SET sort = CASE id WHEN ? THEN 0 WHEN ? THEN 1 WHEN ? THEN 2 END WHERE id IN (?, ?, ?)", [first, hidden, last, first, hidden, last]);
  await c.query("UPDATE cards SET archivedAt = NOW() WHERE id = ?", [hidden]);
  const shown = async (areaId) => (await rest(ownerKey, "GET", `/api/data/cards?areaId=${areaId}`)).body.cards.map((card) => card.name);
  await mcp(ownerKey, "orderCard", { areaId: cards.done, cardOrders: [{ cardId: last, sort: 0 }] });
  check("reordering through MCP counts the cards the board shows", JSON.stringify(await shown(cards.done)) === '["Last","First"]', JSON.stringify(await shown(cards.done)));
  await rest(ownerKey, "POST", "/api/data/cardOrder", { cardId: last, areaId: cards.done, newIndex: 1 });
  check("and so does the REST API", JSON.stringify(await shown(cards.done)) === '["First","Last"]', JSON.stringify(await shown(cards.done)));

  // Onto another board, through either surface.
  const elsewhere = await board("Elsewhere");
  await mcp(ownerKey, "moveCard", { cardId: made.id, toAreaId: elsewhere.todo });
  await rest(ownerKey, "POST", "/api/data/cardMove", { cardId: madeRest.id, fromAreaId: cards.todo, toAreaId: elsewhere.done, newIndex: 0 });
  const [[mcpMoved]] = await c.query("SELECT area FROM cards WHERE id = ?", [made.id]);
  const [[restMoved]] = await c.query("SELECT area FROM cards WHERE id = ?", [madeRest.id]);
  check("a card moves onto another board either way", mcpMoved.area === elsewhere.todo && restMoved.area === elsewhere.done);
  check("and the move goes in its history", (await history(made.id)).at(-1) === "moved" && (await history(madeRest.id)).at(-1) === "moved");

  const shelved = (await rest(ownerKey, "POST", "/api/data/area", { boardId: cards.id, name: "Shelved" })).body.area;
  await rest(ownerKey, "DELETE", `/api/data/area?id=${shelved.id}&boardId=${cards.id}`);
  let mcpInto = false;
  try { await mcp(ownerKey, "createCard", { areaId: shelved.id, name: "Into the archive?" }); } catch { mcpInto = true; }
  const restInto = await rest(ownerKey, "POST", "/api/data/card", { areaId: shelved.id, name: "Into the archive?" });
  check("no card is made in an archived area, either way", mcpInto && restInto.status === 404, String(restInto.status));

  const doomed = await card(cards.todo, "Archived by an agent");
  const removed = await mcp(ownerKey, "deleteCard", { cardId: doomed });
  const [[doomedRow]] = await c.query("SELECT archivedAt FROM cards WHERE id = ?", [doomed]);
  check("deleting a card through MCP archives it, as the app does", removed.archived === true && !!doomedRow?.archivedAt && (await history(doomed)).at(-1) === "archived");

  // What is in the archive is not there for an agent: it is off the board in
  // the app, and nobody changes it until it is restored.
  const filed = await card(cards.todo, "Filed away");
  await rest(ownerKey, "DELETE", "/api/data/card", { cardID: filed });
  const refusedOn = [];
  for (const [tool, args] of [
    ["getCard", { cardId: filed }],
    ["updateCard", { cardId: filed, name: "Changed in the archive?" }],
    ["moveCard", { cardId: filed, toAreaId: cards.done }],
    ["writeComment", { cardId: filed, content: "Said in the archive?" }],
    ["claimCard", { cardId: filed }],
    ["orderCard", { areaId: cards.todo, cardOrders: [{ cardId: filed, sort: 0 }] }],
  ]) {
    try { await mcp(ownerKey, tool, args); } catch { refusedOn.push(tool); }
  }
  const [[filedRow]] = await c.query("SELECT name, area FROM cards WHERE id = ?", [filed]);
  check("an agent cannot read, change, move, comment on or claim a card in the archive",
    refusedOn.length === 6 && filedRow.name === "Filed away" && filedRow.area === cards.todo, JSON.stringify(refusedOn));

  // ------------------------------------------ live, for those looking ----
  console.log("\nlive, for whoever has the board open");
  browser = await chromium.launch();
  const watch = async (boardId) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addCookies([{ name: "session_token", value: anna.token, domain: "127.0.0.1", path: "/" }]);
    const page = await context.newPage();
    await page.goto(`${BASE}/board/${boardId}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    return page;
  };
  const live = await board("Live");
  const liveCard = await card(live.todo, "Before");
  const viewer = await watch(live.id);
  await rest(ownerKey, "PUT", "/api/data/card", { cardID: liveCard, name: "After", content: "", status: false });
  const renamed = await viewer.locator(`[data-card-id="${liveCard}"]`).filter({ hasText: "After" }).first()
    .waitFor({ timeout: 5000 }).then(() => true, () => false);
  check("a card changed with a key changes on the open board", renamed);

  const away = await board("Away");
  const traveller = await card(live.todo, "Travelling");
  await viewer.reload({ waitUntil: "networkidle" });
  await viewer.waitForTimeout(1000);
  const arrivals = await watch(away.id);
  await mcp(ownerKey, "moveCard", { cardId: traveller, toAreaId: away.todo });
  const left = await viewer.locator(`[data-card-id="${traveller}"]`).first().waitFor({ state: "detached", timeout: 5000 }).then(() => true, () => false);
  const arrived = await arrivals.locator(`[data-card-id="${traveller}"]`).first().waitFor({ timeout: 5000 }).then(() => true, () => false);
  check("a card moved to another board leaves the one and arrives on the other, live", left && arrived, JSON.stringify({ left, arrived }));

  await rest(ownerKey, "DELETE", `/api/data/board?id=${live.id}`);
  const sentAway = await viewer.waitForURL((url) => url.pathname.startsWith("/dashboard"), { timeout: 5000 }).then(() => true, () => false);
  check("a board archived with a key sends whoever has it open back to the dashboard", sentAway, viewer.url());
} catch (error) {
  console.error(`\n FAIL  the run stopped early — ${error.message.split("\n")[0]}`);
  failures++;
} finally {
  await stop();
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures ? 1 : 0);
