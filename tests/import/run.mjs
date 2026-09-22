// Boards from Wekan, Nextcloud Deck and a Trello export, through the import
// dialog.
//
// The files are the real exports in test/fixtures/import — written by a real
// Wekan and a real Nextcloud Deck, see the README there. Each is chosen in the
// dashboard's import dialog the way somebody would, and what arrives is checked
// on the board and in the database: the columns and cards in order, the
// descriptions and checklists, labels, due dates, done, comments by name, and
// Wekan's attached files byte for byte. A Deck file holding two boards makes
// two. A file that is neither is turned away with a message rather than a
// half-made board, and a read-only API key cannot import at all.
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
const DB = "lokalboards_import";
const PORT = 3100, BASE = `http://127.0.0.1:${PORT}`;
const creds = { host: env.NUXT_MYSQL_HOST, user: env.NUXT_MYSQL_USER, password: env.NUXT_MYSQL_PASSWORD };
const WEKAN = "test/fixtures/import/wekan-board.json";
const DECK = "test/fixtures/import/deck-export.json";

const admin = await mysql.createConnection(creds);
await admin.query(`DROP DATABASE IF EXISTS \`${DB}\``);
await admin.query(`CREATE DATABASE \`${DB}\``);
await admin.end();

const child = spawn("node", [".output/server/index.mjs"], {
  env: { ...process.env, ...env, NUXT_MYSQL_DATABASE: DB, NUXT_MYSQL_SSL: "false",
         NUXT_PUBLIC_SIGNUP: "true", PORT: String(PORT), NITRO_PORT: String(PORT),
         NUXT_BOARDS_URL: BASE, NUXT_LOG_LEVEL: "error", NUXT_LANGUAGE: "en",
         NUXT_PUBLIC_TRELLO_API_KEY: "testkey0123456789" },
  stdio: ["ignore", "pipe", "pipe"],
});
// Everything the server says, to make sure a Trello token is never in it.
let serverOutput = "";
child.stdout.on("data", (chunk) => (serverOutput += chunk));
child.stderr.on("data", (chunk) => (serverOutput += chunk));
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

  await fetch(`${BASE}/api/auth/sign-up`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Florian", email: "owner@example.test", password: "correct horse battery" }) });
  const signIn = await fetch(`${BASE}/api/auth/sign-in`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "owner@example.test", password: "correct horse battery" }) });
  const cookie = (signIn.headers.getSetCookie?.() ?? []).map((x) => x.split(";")[0]).find((x) => x.startsWith("session_token="));
  const [[owner]] = await c.query("SELECT id FROM `user` WHERE email = 'owner@example.test'");
  await c.query("UPDATE `user` SET onboarded = 1 WHERE id = ?", [owner.id]);

  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await context.addCookies([{ name: "session_token", value: cookie.split("=").slice(1).join("="), domain: "127.0.0.1", path: "/" }]);
  const page = await context.newPage();

  const importThrough = async (file) => {
    await page.goto(`${BASE}/dashboard/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    // The heading's own menu: once there are boards, every tile has one too.
    await page.locator('button[aria-haspopup="menu"]').first().click();
    await page.getByRole("button", { name: "Import boards" }).click();
    await page.locator('[data-testid="import-file"]').setInputFiles(file);
  };
  const toast = async (text) =>
    page.getByText(text).first().waitFor({ timeout: 8000 }).then(() => true, () => false);

  // --- Wekan ---------------------------------------------------------------------
  console.log("\na Wekan board export");
  await importThrough(WEKAN);
  check("says the board was imported", await toast("Board imported"));
  await page.waitForURL(/\/board\/\d+/, { timeout: 8000 }).catch(() => {});
  const boardId = Number(page.url().match(/\/board\/(\d+)/)?.[1]);
  await page.waitForTimeout(1200);
  const [[board]] = await c.query("SELECT name, status FROM boards WHERE id = ?", [boardId]);
  check("and opens it: private, and yours", board?.name === "Website Relaunch" && board?.status === "private", JSON.stringify(board));

  const columns = await page.evaluate(() => [...document.querySelectorAll("[data-card-id]")].map((el) => el.querySelector("h3")?.textContent.trim()));
  check("with its cards on the board, in order, the archived one left behind",
    JSON.stringify(columns) === JSON.stringify(["Redesign the header", "Fix the contact form", "Write the launch post", "Choose a font"]),
    JSON.stringify(columns));
  const [areas] = await c.query("SELECT name FROM areas WHERE board = ? ORDER BY sort", [boardId]);
  check("its lists are its areas", areas.map((a) => a.name).join(",") === "To do,In progress,Done");

  const [[header]] = await c.query("SELECT c.id, c.content, c.status, c.dueDate FROM cards c JOIN areas a ON a.id = c.area WHERE a.board = ? AND c.name = 'Redesign the header'", [boardId]);
  check("the description comes as Markdown, with the checklist under it",
    header.content.endsWith("**Steps**\n\n- [x] Collect references\n- [ ] First draft\n- [ ] Review") && header.content.startsWith("Make the header **sticky**"));
  check("with its due date", new Date(header.dueDate).toISOString() === "2026-10-15T09:00:00.000Z", String(header.dueDate));
  const [labels] = await c.query("SELECT l.name FROM card_labels cl JOIN labels l ON l.id = cl.label WHERE cl.card = ? ORDER BY l.sort", [header.id]);
  check("and its labels", labels.map((l) => l.name).join(",") === "Design,Bug");
  const [comments] = await c.query("SELECT authorName, content FROM comments WHERE card = ? ORDER BY date", [header.id]);
  check("its comments, by name, in order", JSON.stringify(comments.map((x) => [x.authorName, x.content])) ===
    JSON.stringify([["florian", "Looks **good** so far."], ["anna", "I'll take the review."]]));
  const [files] = await c.query("SELECT filename, filetype, filesize, filedata FROM attachments WHERE card = ? ORDER BY id", [header.id]);
  check("and its files, byte for byte",
    files.length === 2 && files[1].filename === "notes.txt" && Buffer.from(files[1].filedata, "base64").toString("utf8") === "Größen: 12px, 16px\n" &&
    files[0].filetype === "image/png" && files[0].filesize === 77,
    JSON.stringify(files.map((f) => [f.filename, f.filetype, f.filesize])));
  const [[font]] = await c.query("SELECT c.status FROM cards c JOIN areas a ON a.id = c.area WHERE a.board = ? AND c.name = 'Choose a font'", [boardId]);
  check("a card whose due date was completed is done", font.status === 1);
  const tile = await page.locator("[data-card-id]", { hasText: "Redesign the header" }).first().innerText();
  check("and the tile shows the labels and checklist progress", tile.includes("Design") && tile.includes("Bug") && tile.includes("1/3"), tile.replace(/\n/g, " | "));

  // --- Deck ----------------------------------------------------------------------
  console.log("\na Nextcloud Deck export");
  const before = (await c.query("SELECT COUNT(*) AS n FROM boards"))[0][0].n;
  await importThrough(DECK);
  check("says how many boards came across", await toast("2 boards imported"));
  await page.waitForURL((url) => /\/board\/\d+/.test(url.pathname) && !url.pathname.endsWith(`/${boardId}`), { timeout: 8000 }).catch(() => {});
  const [newBoards] = await c.query("SELECT id, name FROM boards WHERE id > ? ORDER BY id", [boardId]);
  check("every board in the file is a board here", Number(before) + 2 === Number((await c.query("SELECT COUNT(*) AS n FROM boards"))[0][0].n) &&
    newBoards.map((b) => b.name).join(",") === "Welcome to Nextcloud Deck!,Website Relaunch", JSON.stringify(newBoards));
  const relaunch = newBoards.find((b) => b.name === "Website Relaunch");
  const [[deckCard]] = await c.query("SELECT c.id, c.content, c.dueDate FROM cards c JOIN areas a ON a.id = c.area WHERE a.board = ? AND c.name = 'Redesign the header'", [relaunch.id]);
  const [deckComments] = await c.query("SELECT authorName FROM comments WHERE card = ? ORDER BY date", [deckCard.id]);
  check("with the checklist, the due date and the comments by display name",
    deckCard.content.includes("- [x] Collect references") && new Date(deckCard.dueDate).toISOString() === "2026-10-15T09:00:00.000Z" &&
    deckComments.map((x) => x.authorName).join(",") === "florian,Anna Müller");
  const [[deckDone]] = await c.query("SELECT c.status FROM cards c JOIN areas a ON a.id = c.area WHERE a.board = ? AND c.name = 'Choose a font'", [relaunch.id]);
  check("and done where Deck had it done", deckDone.status === 1);

  // --- Trello -------------------------------------------------------------------------
  // Trello's Export as JSON is the same JSON a public board serves, which the
  // unit tests and the link import read; this file has that shape and two
  // uploaded files. One is a Trello download that will not be handed over —
  // as on a private board, where only somebody signed in to Trello gets them.
  // The other claims to be an upload but points somewhere else entirely, here
  // at a counter on this machine: the file was written by somebody, and the
  // server must not go where it says. Both have to stay on the card as links.
  console.log("\na Trello export file");
  const { createServer } = await import("node:http");
  let hits = 0;
  const trap = createServer((req, res) => { hits++; res.end("nope"); });
  await new Promise((resolve) => trap.listen(0, "127.0.0.1", resolve));
  const trapUrl = `http://127.0.0.1:${trap.address().port}/1/cards/c1/attachments/f2/download/secret.txt`;
  const trelloFile = "/tmp/lokalboards-trello-export.json";
  fs.writeFileSync(trelloFile, JSON.stringify({
    id: "5f0000000000000000000001", name: "Private launch", shortLink: "AbCd1234", closed: false,
    prefs: { permissionLevel: "private" },
    lists: [{ id: "l1", name: "To do", pos: 1, closed: false }, { id: "l2", name: "Old", pos: 2, closed: true }],
    cards: [{
      id: "c1", idList: "l1", name: "Book the venue", desc: "Somewhere **central**.", pos: 1, closed: false,
      due: "2026-11-02T09:00:00.000Z", dueComplete: false,
      labels: [{ id: "a", name: "Events", color: "green" }],
      attachments: [
        { id: "f1", name: "floor plan.pdf", isUpload: true, mimeType: "application/pdf", bytes: 1200,
          url: "https://trello.com/1/cards/000000000000000000000000/attachments/000000000000000000000000/download/floor plan.pdf" },
        { id: "f2", name: "secret.txt", isUpload: true, mimeType: "text/plain", bytes: 10, url: trapUrl },
      ],
    }],
    checklists: [{ id: "k1", idCard: "c1", name: "Before", pos: 1, checkItems: [{ name: "Call them", state: "complete", pos: 1 }, { name: "Pay", state: "incomplete", pos: 2 }] }],
    actions: [{ type: "commentCard", date: "2026-09-20T10:00:00.000Z", idMemberCreator: "m1", data: { card: { id: "c1" }, text: "They have a projector." } }],
    members: [{ id: "m1", fullName: "Anna Müller", username: "anna" }],
  }));
  const sentToken = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/data/import/file")) sentToken.push(request.headers()["x-trello-token"] ?? "");
  });
  await importThrough(trelloFile);
  // A private board with files: first the step that asks for Trello access.
  const step = page.getByRole("heading", { name: "Bring the files along" });
  check("a private board with files asks for Trello access first",
    await step.waitFor({ timeout: 5000 }).then(() => true, () => false));
  const allow = await page.getByRole("link", { name: "Allow in Trello" }).getAttribute("href");
  check("the Allow link asks Trello for a token that can only read, for an hour",
    allow.startsWith("https://trello.com/1/authorize?") && allow.includes("key=testkey0123456789") &&
    allow.includes("scope=read") && allow.includes("expiration=1hour") && allow.includes("response_type=token"), allow);
  const token = "ATTAfaketoken0123456789abcdefABCDEF";
  await page.locator('[data-testid="trello-token"]').fill(token);
  await page.getByRole("button", { name: "Import with the files" }).click();
  check("it is imported from the same dialog", await toast("Board imported"));
  check("with the token sent along as a header", sentToken.at(-1) === token, JSON.stringify(sentToken));
  check("and says how many files stayed behind", await toast("2 files could not be copied"));
  await page.waitForURL((url) => /\/board\/\d+/.test(url.pathname), { timeout: 8000 }).catch(() => {});
  const [[venue]] = await c.query("SELECT c.id, c.content, c.dueDate FROM cards c JOIN areas a ON a.id = c.area JOIN boards b ON b.id = a.board WHERE b.name = 'Private launch' AND c.name = 'Book the venue'");
  check("with its description, checklist and due date",
    venue?.content.startsWith("Somewhere **central**.\n\n**Before**\n\n- [x] Call them\n- [ ] Pay") &&
    new Date(venue.dueDate).toISOString() === "2026-11-02T09:00:00.000Z", JSON.stringify(venue?.content));
  const [[venueLabel]] = await c.query("SELECT l.name FROM card_labels cl JOIN labels l ON l.id = cl.label WHERE cl.card = ?", [venue.id]);
  const [[venueComment]] = await c.query("SELECT authorName, content FROM comments WHERE card = ?", [venue.id]);
  check("its label and its comment by name", venueLabel?.name === "Events" && venueComment?.authorName === "Anna Müller");
  check("the files Trello would not hand over stay on the card as links",
    venue.content.includes("**Attachments that could not be copied**") &&
    venue.content.includes("- [floor plan.pdf](https://trello.com/1/cards/000000000000000000000000/attachments/000000000000000000000000/download/floor%20plan.pdf)") &&
    venue.content.includes(`- [secret.txt](${trapUrl})`), venue.content.split("**Attachments")[1]);
  const [[{ kept }]] = await c.query("SELECT COUNT(*) AS kept FROM attachments WHERE card = ?", [venue.id]);
  check("and nothing half-downloaded is stored in their place", Number(kept) === 0);
  check("an address in the file that is not Trello's is never requested", hits === 0, `${hits} request(s)`);
  check("and the token is nowhere in what the server wrote", !serverOutput.includes(token) && !serverOutput.includes("oauth_token"));
  trap.close();
  fs.rmSync(trelloFile);

  // --- Not an export ---------------------------------------------------------------
  console.log("\nsomething that is not an export");
  const stray = "/tmp/lokalboards-not-an-export.json";
  fs.writeFileSync(stray, JSON.stringify({ hello: "world" }));
  const count = (await c.query("SELECT COUNT(*) AS n FROM boards"))[0][0].n;
  await importThrough(stray);
  check("is turned away with a message", await toast("isn't an export from Trello, Wekan or Nextcloud Deck"));
  check("and makes no board", (await c.query("SELECT COUNT(*) AS n FROM boards"))[0][0].n === count);
  fs.rmSync(stray);

  const { key } = await (await fetch(`${BASE}/api/auth/api-key/create`, { method: "POST",
    headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ name: "ro", readOnly: true }) })).json();
  const refused = await fetch(`${BASE}/api/data/import/file`, { method: "POST",
    headers: { "x-api-key": key, "content-type": "application/json" }, body: fs.readFileSync(WEKAN) });
  check("a read-only API key cannot import", refused.status === 403, String(refused.status));
} catch (error) {
  console.error(`\n FAIL  the run stopped early — ${error.message.split("\n")[0]}`);
  failures++;
} finally {
  await stop();
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures ? 1 : 0);
