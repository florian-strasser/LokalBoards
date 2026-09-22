// Deleting a card, an area or a board for good takes everything belonging to
// it — the attachment rows, the uploaded files, the comments, the reminders,
// the people on it and the activity — and the migration clears what earlier
// versions left behind.
//
// "For good": a plain delete archives, and an archived card keeps all of this
// so that it can come back. Deleting permanently, as the archive dialog does,
// is what has to leave nothing behind.
//
// The files are the part worth checking on disk rather than in the database: a
// row that survives is visible in a query, a file that survives is invisible
// until the volume fills up.
import mysql from "mysql2/promise";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split("\n")
  .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
const db = () => mysql.createConnection({ host: env.NUXT_MYSQL_HOST, user: env.NUXT_MYSQL_USER, password: env.NUXT_MYSQL_PASSWORD, database: env.NUXT_MYSQL_DATABASE });
const UPLOADS = path.join(process.cwd(), "public", "uploads");
const PORT = Number(process.env.CLEANUP_TEST_PORT || 3113);
const BASE = `http://127.0.0.1:${PORT}`;

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
};

const sweep = async () => {
  const c = await db();
  const [rows] = await c.execute("SELECT filedata FROM attachments WHERE filedata LIKE '/api/uploads/leak-%'");
  for (const r of rows) { try { fs.unlinkSync(path.join(UPLOADS, String(r.filedata).split("/").pop())); } catch {} }
  await c.execute("DELETE FROM attachments WHERE filedata LIKE '/api/uploads/leak-%'");
  const scope = "IN (SELECT c.id FROM cards c JOIN areas a ON c.area = a.id JOIN boards b ON a.board = b.id WHERE b.name LIKE 'Leak %')";
  for (const t of ["attachments", "comments", "card_reminders", "card_activity", "card_assignees"]) await c.execute(`DELETE FROM \`${t}\` WHERE card ${scope}`);
  await c.execute("DELETE FROM cards WHERE area IN (SELECT id FROM areas WHERE board IN (SELECT id FROM boards WHERE name LIKE 'Leak %'))");
  await c.execute("DELETE FROM areas WHERE board IN (SELECT id FROM boards WHERE name LIKE 'Leak %')");
  await c.execute("DELETE FROM notifications WHERE boardId IN (SELECT id FROM boards WHERE name LIKE 'Leak %')");
  await c.execute("DELETE FROM boards WHERE name LIKE 'Leak %'");
  for (const t of ["session", "account"]) await c.execute(`DELETE FROM \`${t}\` WHERE userId IN (SELECT id FROM \`user\` WHERE email LIKE '%@example.test')`);
  await c.execute("DELETE FROM `user` WHERE email LIKE '%@example.test'");
  await c.end();
};

// A card with everything hanging off it: a stored file, a base64 attachment,
// comments, a reminder and an activity row.
const seedCard = async (c, areaId, label) => {
  const [card] = await c.execute("INSERT INTO `cards` (`name`, `area`, `sort`) VALUES (?, ?, 1)", [label, areaId]);
  const name = `leak-${crypto.randomBytes(8).toString("hex")}.txt`;
  fs.mkdirSync(UPLOADS, { recursive: true });
  fs.writeFileSync(path.join(UPLOADS, name), "bytes for " + label);
  await c.execute("INSERT INTO `attachments` (`card`, `filename`, `filetype`, `filesize`, `filedata`) VALUES (?, 'f.txt', 'text/plain', 9, ?)",
    [card.insertId, `/api/uploads/${name}`]);
  await c.execute("INSERT INTO `attachments` (`card`, `filename`, `filetype`, `filesize`, `filedata`) VALUES (?, 'inline.txt', 'text/plain', 5, ?)",
    [card.insertId, Buffer.from("inline").toString("base64")]);
  await c.execute("INSERT INTO `comments` (`card`, `user`, `content`) VALUES (?, NULL, 'a comment')", [card.insertId]);
  await c.execute("INSERT INTO `card_reminders` (`card`, `minutesBefore`) VALUES (?, 30)", [card.insertId]);
  await c.execute("INSERT INTO `card_activity` (`card`, `type`) VALUES (?, 'created')", [card.insertId]).catch(() => {});
  await c.execute("INSERT INTO `card_assignees` (`card`, `user`) SELECT ?, `id` FROM `user` WHERE email LIKE '%@example.test' LIMIT 1", [card.insertId]);
  return { cardId: card.insertId, file: name };
};

const leftovers = async (c, cardId) => {
  const counts = {};
  for (const t of ["attachments", "comments", "card_reminders", "card_activity", "card_assignees"]) {
    const [[row]] = await c.execute(`SELECT COUNT(*) n FROM \`${t}\` WHERE card = ?`, [cardId]);
    counts[t] = row.n;
  }
  return counts;
};

async function startApp() {
  const child = spawn("node", [".output/server/index.mjs"], {
    env: { ...process.env, ...env, PORT: String(PORT), NUXT_BOARDS_URL: BASE, NUXT_MYSQL_SSL: "false" },
    stdio: ["ignore", "pipe", "pipe"] });
  const logs = []; child.stdout.on("data", (d) => logs.push(String(d))); child.stderr.on("data", (d) => logs.push(String(d)));
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error("app exited:\n" + logs.join(""));
    try { if ((await fetch(BASE + "/")).ok) return { child, logs }; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("app did not start:\n" + logs.join(""));
}
const stopApp = (app) => new Promise((r) => { if (app.child.exitCode !== null) return r(); app.child.once("exit", r); app.child.kill("SIGTERM"); });

await sweep();

// A signed-in owner to delete things as.
const app = await startApp();
const email = "leak" + crypto.randomBytes(3).toString("hex") + "@example.test";
const secret = crypto.randomBytes(12).toString("base64url") + "Aa1!";
const signUp = await fetch(`${BASE}/api/auth/sign-up`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "Leak Tester", email, password: secret }) });
const cookie = (signUp.headers.get("set-cookie") || "").split(";")[0];
const c = await db();
const [[owner]] = await c.execute("SELECT id FROM `user` WHERE email = ?", [email]);

const api = (url, options = {}) => fetch(BASE + url, { ...options, redirect: "manual",
  headers: { cookie, "content-type": "application/json", ...(options.headers || {}) } });

console.log("\n1. deleting a card takes its attachments, files and the rest");
{
  const [board] = await c.execute("INSERT INTO `boards` (`name`, `user`) VALUES ('Leak Card', ?)", [owner.id]);
  const [area] = await c.execute("INSERT INTO `areas` (`name`, `board`, `sort`) VALUES ('Todo', ?, 1)", [board.insertId]);
  const seeded = await seedCard(c, area.insertId, "Card to delete");
  check("the file exists to begin with", fs.existsSync(path.join(UPLOADS, seeded.file)));
  const res = await api("/api/data/card", { method: "DELETE", body: JSON.stringify({ cardID: seeded.cardId, permanent: true }) });
  check("the card was deleted", res.status === 200, `status ${res.status}`);
  const after = await leftovers(c, seeded.cardId);
  check("no rows left behind", Object.values(after).every((n) => n === 0), JSON.stringify(after));
  check("the uploaded file is gone", !fs.existsSync(path.join(UPLOADS, seeded.file)));
}

console.log("\n2. deleting an area takes everything in it");
{
  const [board] = await c.execute("INSERT INTO `boards` (`name`, `user`) VALUES ('Leak Area', ?)", [owner.id]);
  const [area] = await c.execute("INSERT INTO `areas` (`name`, `board`, `sort`) VALUES ('Todo', ?, 1)", [board.insertId]);
  const a = await seedCard(c, area.insertId, "One");
  const b = await seedCard(c, area.insertId, "Two");
  const res = await api(`/api/data/area?id=${area.insertId}&boardId=${board.insertId}&permanent=true`, { method: "DELETE" });
  check("the area was deleted", res.status === 200, `status ${res.status}`);
  const rows = { ...(await leftovers(c, a.cardId)), ...(await leftovers(c, b.cardId)) };
  check("no rows left behind", Object.values(rows).every((n) => n === 0), JSON.stringify(rows));
  check("both files are gone", !fs.existsSync(path.join(UPLOADS, a.file)) && !fs.existsSync(path.join(UPLOADS, b.file)));
}

console.log("\n3. deleting a board takes every card on it");
{
  const [board] = await c.execute("INSERT INTO `boards` (`name`, `user`) VALUES ('Leak Board', ?)", [owner.id]);
  const [area] = await c.execute("INSERT INTO `areas` (`name`, `board`, `sort`) VALUES ('Todo', ?, 1)", [board.insertId]);
  const a = await seedCard(c, area.insertId, "One");
  const res = await api(`/api/data/board?id=${board.insertId}&userId=${owner.id}&permanent=true`, { method: "DELETE" });
  check("the board was deleted", res.status === 200, `status ${res.status}`);
  check("no rows left behind", Object.values(await leftovers(c, a.cardId)).every((n) => n === 0));
  check("the file is gone", !fs.existsSync(path.join(UPLOADS, a.file)));
}

console.log("\n4. a file two attachments share is not taken from under the other");
{
  const [board] = await c.execute("INSERT INTO `boards` (`name`, `user`) VALUES ('Leak Shared', ?)", [owner.id]);
  const [area] = await c.execute("INSERT INTO `areas` (`name`, `board`, `sort`) VALUES ('Todo', ?, 1)", [board.insertId]);
  const keeper = await seedCard(c, area.insertId, "Keeps the file");
  const [goer] = await c.execute("INSERT INTO `cards` (`name`, `area`, `sort`) VALUES ('Goes away', ?, 2)", [area.insertId]);
  // The same path on a second card, as an instance from before duplication
  // copied files might have.
  await c.execute("INSERT INTO `attachments` (`card`, `filename`, `filetype`, `filesize`, `filedata`) VALUES (?, 'f.txt', 'text/plain', 9, ?)",
    [goer.insertId, `/api/uploads/${keeper.file}`]);
  const res = await api("/api/data/card", { method: "DELETE", body: JSON.stringify({ cardID: goer.insertId, permanent: true }) });
  check("the second card was deleted", res.status === 200, `status ${res.status}`);
  check("the shared file is still there", fs.existsSync(path.join(UPLOADS, keeper.file)));
  const [[still]] = await c.execute("SELECT COUNT(*) n FROM attachments WHERE card = ?", [keeper.cardId]);
  check("the first card still has its attachments", still.n === 2, `${still.n}`);
}

console.log("\n5. the migration clears what earlier versions left behind");
{
  // Debris of the kind that accumulated: rows whose card is already gone.
  const orphanFile = `leak-${crypto.randomBytes(8).toString("hex")}.txt`;
  fs.writeFileSync(path.join(UPLOADS, orphanFile), "orphan");
  const ghostCard = 999000000 + Math.floor(Math.random() * 1000);
  await c.execute("INSERT INTO `attachments` (`card`, `filename`, `filetype`, `filesize`, `filedata`) VALUES (?, 'ghost.txt', 'text/plain', 6, ?)",
    [ghostCard, `/api/uploads/${orphanFile}`]);
  await c.execute("INSERT INTO `comments` (`card`, `user`, `content`) VALUES (?, NULL, 'ghost')", [ghostCard]);
  await c.execute("INSERT INTO `card_reminders` (`card`, `minutesBefore`) VALUES (?, 15)", [ghostCard]);
  await c.execute("DELETE FROM `migrations` WHERE `id` = '0020_orphaned_card_data'");
  await c.end();

  await stopApp(app);            // the migration runs at boot
  const again = await startApp();
  const c2 = await db();
  const rows = await leftovers(c2, ghostCard);
  check("the orphaned rows are gone", Object.values(rows).every((n) => n === 0), JSON.stringify(rows));
  check("the orphaned file is gone", !fs.existsSync(path.join(UPLOADS, orphanFile)));
  const [[applied]] = await c2.execute("SELECT COUNT(*) n FROM `migrations` WHERE `id` = '0020_orphaned_card_data'");
  check("the migration recorded itself", applied.n === 1);
  await c2.end();
  await stopApp(again);
}

await sweep();
const c3 = await db();
const [[left]] = await c3.execute("SELECT COUNT(*) n FROM attachments WHERE filedata LIKE '/api/uploads/leak-%'");
console.log(`\ncleanup: ${left.n} test attachment rows left, ${fs.readdirSync(UPLOADS).filter((f) => f.startsWith("leak-")).length} test files left`);
await c3.end();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
