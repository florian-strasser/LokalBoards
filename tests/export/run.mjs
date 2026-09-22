// Exports: one board as a zip, and the whole instance for an administrator.
//
// Builds a board with everything an export has to carry — an uploaded
// attachment, one from before uploads went to disk, a picture pasted into a
// description, comments, labels, a reminder, history, an archived area and an
// archived card — then downloads both exports, unpacks them and reads them back.
// The database dump is restored into a second, empty database and compared row
// for row with the one it came from, because a dump nobody has restored is only
// a hope.
//
// The server runs in a directory of its own, so the files it reads as uploads
// are the ones this test wrote and nothing in the project's own uploads is
// touched.
//
// Requires a built app (`npm run build`), `unzip`, and the credentials in
// `.env.local`. Creates and drops databases of its own.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import mysql from "mysql2/promise";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const DB = "lokalboards_exporttest";
const RESTORED = "lokalboards_exporttest_restored";
const PORT = 3100, BASE = `http://127.0.0.1:${PORT}`;
const creds = { host: env.NUXT_MYSQL_HOST, user: env.NUXT_MYSQL_USER, password: env.NUXT_MYSQL_PASSWORD };

const work = fs.mkdtempSync(path.join(os.tmpdir(), "lokalboards-export-"));
const uploads = path.join(work, "public", "uploads");
fs.mkdirSync(uploads, { recursive: true });

const admin = await mysql.createConnection(creds);
for (const name of [DB, RESTORED]) {
  await admin.query(`DROP DATABASE IF EXISTS \`${name}\``);
  await admin.query(`CREATE DATABASE \`${name}\``);
}
await admin.end();

const child = spawn("node", [path.resolve(".output/server/index.mjs")], {
  cwd: work,
  env: { ...process.env, ...env, NUXT_MYSQL_DATABASE: DB, NUXT_MYSQL_SSL: "false",
         NUXT_PUBLIC_SIGNUP: "true", PORT: String(PORT), NITRO_PORT: String(PORT),
         NUXT_BOARDS_URL: BASE, NUXT_LOG_LEVEL: "error", NUXT_LANGUAGE: "en" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverErrors = "";
child.stderr.on("data", (chunk) => { serverErrors += chunk; });
for (let i = 0; i < 160; i++) {
  try { if ((await fetch(BASE + "/")).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
const c = await mysql.createConnection({ ...creds, database: DB, timezone: "Z" });
// The app reads and writes in UTC; so does this, or a TIMESTAMP written here
// would be shifted by the database server's own zone on the way in.
await c.query("SET time_zone = '+00:00'");
for (let i = 0; i < 200; i++) {
  const [r] = await c.query("SELECT 1 FROM `migrations` WHERE `id` LIKE '0028%'").catch(() => [[]]);
  if (r.length) break;
  await new Promise((r) => setTimeout(r, 250));
}

let failures = 0;
const stop = async () => {
  child.kill("SIGKILL");
  await c.end().catch(() => {});
  const cleanup = await mysql.createConnection(creds);
  for (const name of [DB, RESTORED]) await cleanup.query(`DROP DATABASE IF EXISTS \`${name}\``);
  await cleanup.end();
  fs.rmSync(work, { recursive: true, force: true });
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
    return { id: row.id, cookie, email };
  };
  const owner = await account("Owner Person", "owner@example.test");
  const member = await account("Member Person", "member@example.test");
  const stranger = await account("Stranger", "stranger@example.test");
  const boss = await account("Admin Person", "admin@example.test");
  await c.query("UPDATE `user` SET role = 'admin' WHERE id = ?", [boss.id]);

  // ------------------------------------------------------------ a board ----
  const [board] = await c.execute("INSERT INTO boards (user, name, status) VALUES (?,?,?)", [owner.id, "Website Relaunch Ü", "private"]);
  const boardId = board.insertId;
  const folder = `${boardId}-website-relaunch-u`;
  await c.execute("INSERT INTO invitations (board, user, permission) VALUES (?,?,?)", [boardId, member.id, "read"]);
  const [todo] = await c.execute("INSERT INTO areas (board, name, sort) VALUES (?,?,?)", [boardId, "Todo", 0]);
  const [gone] = await c.execute("INSERT INTO areas (board, name, sort, archivedAt) VALUES (?,?,?,UTC_TIMESTAMP())", [boardId, "Old ideas", 1]);

  const pasted = `${randomBytes(16).toString("hex")}.png`;
  const pastedBytes = randomBytes(300);
  fs.writeFileSync(path.join(uploads, pasted), pastedBytes);
  const tricky = `<p>O'Reilly \\ "quoted"</p>\n<p>Zeile zwei 🚀</p><img src="/api/uploads/${pasted}">`;
  const due = new Date(Date.UTC(2026, 9, 1, 14, 30, 0));
  const [website] = await c.execute("INSERT INTO cards (area, name, content, sort, dueDate) VALUES (?,?,?,?,?)",
    [todo.insertId, "Website", tricky, 0, due]);
  const cardId = website.insertId;
  await c.execute("INSERT INTO card_assignees (card, user) VALUES (?,?),(?,?)", [cardId, member.id, cardId, owner.id]);
  const [thrown] = await c.execute("INSERT INTO cards (area, name, content, sort, archivedAt) VALUES (?,?,?,?,UTC_TIMESTAMP())", [todo.insertId, "Thrown away", "", 1]);
  await c.execute("INSERT INTO cards (area, name, content, sort) VALUES (?,?,?,?)", [gone.insertId, "Inside the archived area", "", 0]);

  const [label] = await c.execute("INSERT INTO labels (board, name, color) VALUES (?,?,?)", [boardId, "Webdesign", "#0066cc"]);
  await c.execute("INSERT INTO card_labels (card, label) VALUES (?,?)", [cardId, label.insertId]);
  await c.execute("INSERT INTO card_reminders (card, minutesBefore) VALUES (?,?)", [cardId, 60]);
  await c.execute("INSERT INTO card_activity (card, actorId, type, data) VALUES (?,?,?,?)", [cardId, owner.id, "labels", JSON.stringify({ added: ["Webdesign"], removed: [] })]);
  await c.execute("INSERT INTO comments (card, user, content) VALUES (?,?,?)", [cardId, owner.id, `<p>Looks good</p><img src="/uploads/${pasted}">`]);

  const storedName = `${randomBytes(16).toString("hex")}.txt`;
  const storedBytes = Buffer.from("Umsatz;Q3\n1000;2000\n");
  fs.writeFileSync(path.join(uploads, storedName), storedBytes);
  const [stored] = await c.execute("INSERT INTO attachments (card, filename, filetype, filesize, filedata) VALUES (?,?,?,?,?)",
    [cardId, "Quartalszahlen Ü.txt", "text/plain", storedBytes.length, `/api/uploads/${storedName}`]);
  const legacyBytes = Buffer.from("bytes from before uploads went to disk");
  const [legacy] = await c.execute("INSERT INTO attachments (card, filename, filetype, filesize, filedata) VALUES (?,?,?,?,?)",
    [cardId, "../../legacy.txt", "text/plain", legacyBytes.length, legacyBytes.toString("base64")]);
  const [missing] = await c.execute("INSERT INTO attachments (card, filename, filetype, filesize, filedata) VALUES (?,?,?,?,?)",
    [cardId, "gone.pdf", "application/pdf", 10, `/api/uploads/${randomBytes(16).toString("hex")}.pdf`]);

  // Enough comments on a second board to need more than one INSERT per table.
  const [busy] = await c.execute("INSERT INTO boards (user, name, status, archivedAt) VALUES (?,?,?,UTC_TIMESTAMP())", [owner.id, "Archived and busy", "private"]);
  const [busyArea] = await c.execute("INSERT INTO areas (board, name, sort) VALUES (?,?,?)", [busy.insertId, "Lots", 0]);
  const [busyCard] = await c.execute("INSERT INTO cards (area, name, content, sort) VALUES (?,?,?,?)", [busyArea.insertId, "Chatty", "", 0]);
  const filler = "x".repeat(600);
  for (let i = 0; i < 1500; i += 250) {
    const rows = Array.from({ length: 250 }, (_, j) => [busyCard.insertId, owner.id, `${i + j} ${filler}`]);
    await c.query("INSERT INTO comments (card, user, content) VALUES ?", [rows]);
  }

  const get = (url, who) => fetch(`${BASE}${url}`, { headers: who ? { cookie: who.cookie } : {} });
  const unpack = async (response, name) => {
    const file = path.join(work, `${name}.zip`);
    fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
    const dir = path.join(work, name);
    execFileSync("unzip", ["-q", file, "-d", dir]);
    const list = [];
    const walk = (at) => { for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, entry.name);
      entry.isDirectory() ? walk(full) : list.push(path.relative(dir, full));
    } };
    walk(dir);
    return { dir, list: list.sort() };
  };

  // ------------------------------------------------------- board export ----
  const signedOut = await get(`/api/data/board-export?boardId=${boardId}`);
  check("nobody signed in gets nothing", signedOut.status === 403 && !signedOut.headers.get("content-type")?.includes("zip"), `status ${signedOut.status}`);
  const strangers = await get(`/api/data/board-export?boardId=${boardId}`, stranger);
  check("somebody who cannot see the board gets nothing", strangers.status === 404 && !strangers.headers.get("content-type")?.includes("zip"), `status ${strangers.status}`);
  check("a board that does not exist is a 404", (await get(`/api/data/board-export?boardId=999999`, owner)).status === 404);

  const response = await get(`/api/data/board-export?boardId=${boardId}`, member);
  check("a member who can only read the board can export it", response.status === 200, `status ${response.status}`);
  check("and gets a zip", response.headers.get("content-type") === "application/zip");
  const disposition = response.headers.get("content-disposition") || "";
  check("named after the board and the day", disposition.startsWith("attachment;") && disposition.includes(`${folder}-`) && disposition.includes(".zip"), disposition);

  const one = await unpack(response, "board");
  check("the zip holds the board's JSON at its root", one.list.includes(`${folder}.json`), one.list.join(", "));
  const json = JSON.parse(fs.readFileSync(path.join(one.dir, `${folder}.json`), "utf8"));
  check("which says what it is", json.format === "lokalboards.board" && json.formatVersion === 1 && typeof json.lokalboardsVersion === "string", `${json.format} ${json.formatVersion} ${json.lokalboardsVersion}`);
  check("with the board's name and owner", json.board?.name === "Website Relaunch Ü" && json.board?.owner?.name === "Owner Person");
  check("and its members by name", json.members?.length === 1 && json.members[0].name === "Member Person" && json.members[0].permission === "read");
  check("and no email address anywhere in it", !JSON.stringify(json).includes("@example.test"));
  check("an archived area comes along, saying so", json.areas?.length === 2 && json.areas[1].archivedAt && json.areas[1].cards.length === 1);
  const todoCards = json.areas?.[0]?.cards ?? [];
  check("so does an archived card", todoCards.some((card) => card.id === thrown.insertId && card.archivedAt));

  const card = todoCards.find((entry) => entry.id === cardId) ?? {};
  check("a description comes through character for character", card.content === tricky);
  check("with its due date", card.dueDate === due.toISOString(), card.dueDate);
  check("who it is on, everyone of them in order",
    JSON.stringify(card.assignees?.map((person) => person.name)) === JSON.stringify(["Member Person", "Owner Person"]) &&
    card.assignee?.name === "Member Person", JSON.stringify(card.assignees));
  check("its labels by name", JSON.stringify(card.labels) === JSON.stringify(["Webdesign"]));
  check("its reminders", JSON.stringify(card.reminders) === JSON.stringify([60]));
  check("its history", card.activity?.[0]?.type === "labels" && card.activity[0].actor?.name === "Owner Person" && card.activity[0].data?.added?.[0] === "Webdesign");
  check("its comments, with who wrote them", card.comments?.[0]?.author?.name === "Owner Person" && card.comments[0].content.includes("Looks good"));

  const byId = Object.fromEntries((card.attachments ?? []).map((a) => [a.id, a]));
  const storedEntry = byId[stored.insertId];
  check("an uploaded attachment is in attachments/, under its own name", storedEntry?.file === `attachments/${stored.insertId}-Quartalszahlen Ü.txt`, storedEntry?.file);
  check("with the same bytes", storedEntry?.file && fs.readFileSync(path.join(one.dir, storedEntry.file)).equals(storedBytes));
  const legacyEntry = byId[legacy.insertId];
  check("an attachment kept in the database is written out as a file too", legacyEntry?.file && fs.readFileSync(path.join(one.dir, legacyEntry.file)).equals(legacyBytes), legacyEntry?.file);
  check("and its name cannot climb out of the folder", legacyEntry?.file?.startsWith("attachments/") && !legacyEntry.file.includes("/../") && one.list.every((entry) => !entry.startsWith("..")));
  check("an attachment whose file is gone is listed without one", byId[missing.insertId] && byId[missing.insertId].file === null);

  const imageAt = json.images?.[`/api/uploads/${pasted}`];
  check("a pasted picture is in the zip, and the JSON says where", imageAt === `attachments/images/${pasted}` && fs.readFileSync(path.join(one.dir, imageAt)).equals(pastedBytes), imageAt);
  check("the same picture named another way is not copied twice", json.images?.[`/uploads/${pasted}`] === imageAt && one.list.filter((entry) => entry.endsWith(pasted)).length === 1);

  // ---------------------------------------------------- the whole instance --
  check("an owner who is not an administrator cannot export everything", (await get("/api/data/export", owner)).status === 403);
  const signedOutAll = await get("/api/data/export");
  check("nor can anybody signed out", signedOutAll.status === 403 && !signedOutAll.headers.get("content-type")?.includes("zip"), `status ${signedOutAll.status}`);

  const everything = await get("/api/data/export", boss);
  check("an administrator can", everything.status === 200 && everything.headers.get("content-type") === "application/zip", `status ${everything.status}`);
  check("named for the day", (everything.headers.get("content-disposition") || "").includes("lokalboards-export-"));
  const all = await unpack(everything, "everything");
  check("every board has its JSON under boards/, archived ones too",
    all.list.includes(`boards/${folder}.json`) && all.list.includes(`boards/${busy.insertId}-archived-and-busy.json`), all.list.filter((e) => e.startsWith("boards/")).join(", "));
  check("each board's files are in a folder of its own",
    all.list.includes(`attachments/${folder}/${stored.insertId}-Quartalszahlen Ü.txt`) && all.list.includes(`attachments/${folder}/images/${pasted}`));
  const everyJson = JSON.parse(fs.readFileSync(path.join(all.dir, `boards/${folder}.json`), "utf8"));
  const everyCard = everyJson.areas[0].cards.find((entry) => entry.id === cardId);
  check("and the paths in its JSON point there",
    everyCard.attachments.find((a) => a.id === stored.insertId)?.file === `attachments/${folder}/${stored.insertId}-Quartalszahlen Ü.txt`);
  check("the zip holds the database", all.list.includes("database.sql"));

  const sql = fs.readFileSync(path.join(all.dir, "database.sql"), "utf8");
  check("which creates every table", ["boards", "cards", "comments", "user", "migrations", "oauth_tokens"].every((t) => sql.includes(`CREATE TABLE \`${t}\``)));
  check("and leaves sign-in sessions out", sql.includes("CREATE TABLE `session`") && !sql.includes("INSERT INTO `session`"));
  const commentInserts = sql.split("INSERT INTO `comments`").length - 1;
  check("a big table is written in more than one statement", commentInserts > 1, `${commentInserts} statements`);

  const restore = await mysql.createConnection({ ...creds, database: RESTORED, multipleStatements: true, timezone: "Z" });
  await restore.query("SET time_zone = '+00:00'");
  let restored = true;
  try { await restore.query(sql); } catch (error) { restored = false; console.error(error.message.slice(0, 300)); }
  check("the dump restores into an empty database without an error", restored);

  for (const table of ["user", "account", "boards", "areas", "cards", "comments", "attachments", "labels", "card_labels", "card_reminders", "card_activity", "invitations", "migrations"]) {
    const [[a]] = await c.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
    const [[b]] = await restore.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
    check(`${table}: every row came back`, a.n === b.n && a.n > 0, `${a.n} → ${b.n}`);
  }
  const [[sessions]] = await restore.query("SELECT COUNT(*) AS n FROM `session`");
  check("and no session did", sessions.n === 0);

  const pick = "SELECT c.name, c.content, c.dueDate, c.archivedAt, (SELECT GROUP_CONCAT(ca.user ORDER BY ca.id) FROM card_assignees ca WHERE ca.card = c.id) AS people FROM cards c ORDER BY c.id";
  const [before] = await c.query(pick);
  const [after] = await restore.query(pick);
  check("every card reads the same as before, dates and all", JSON.stringify(before) === JSON.stringify(after));
  const [[accountBefore]] = await c.query("SELECT password FROM account WHERE userId = ?", [owner.id]);
  const [[accountAfter]] = await restore.query("SELECT password FROM account WHERE userId = ?", [owner.id]);
  check("a password hash survives, so people can sign in to a restored instance", accountBefore.password === accountAfter.password && !!accountAfter.password);
  const [[bigBefore]] = await c.query("SELECT MD5(GROUP_CONCAT(content ORDER BY id SEPARATOR '|')) AS h FROM comments");
  const [[bigAfter]] = await restore.query("SELECT MD5(GROUP_CONCAT(content ORDER BY id SEPARATOR '|')) AS h FROM comments");
  check("and every comment is intact", bigBefore.h === bigAfter.h);
  await restore.end();

  // Only what the export said: signing up tries to send a welcome email, and
  // there is no mail server here to take it.
  const exportErrors = serverErrors.split("\n").filter((line) => /export/i.test(line));
  check("the server logged no errors while exporting", exportErrors.length === 0, exportErrors.join(" ").slice(0, 300));
} catch (error) {
  console.error(`\n FAIL  the run stopped early — ${error.message.split("\n")[0]}`);
  failures++;
} finally {
  await stop();
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures ? 1 : 0);
