// Duplicating a board copies its columns and none of its cards.
//
// Requires a built app (`npm run build`) and the credentials in `.env.local`.
// Creates and drops a database of its own; it never touches an existing one.
import fs from "node:fs";
import { spawn } from "node:child_process";
import mysql from "mysql2/promise";
import { chromium } from "playwright";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const DB = "lokalboards_dup";
const PORT = 3100, BASE = `http://127.0.0.1:${PORT}`;
const creds = { host: env.NUXT_MYSQL_HOST, user: env.NUXT_MYSQL_USER, password: env.NUXT_MYSQL_PASSWORD };

const admin = await mysql.createConnection(creds);
await admin.query(`DROP DATABASE IF EXISTS \`${DB}\``);
await admin.query(`CREATE DATABASE \`${DB}\``);
await admin.end();

const child = spawn("node", [".output/server/index.mjs"], {
  env: { ...process.env, ...env, NUXT_MYSQL_DATABASE: DB, NUXT_MYSQL_SSL: "false",
         NUXT_PUBLIC_SIGNUP: "true", PORT: String(PORT), NITRO_PORT: String(PORT),
         NUXT_BOARDS_URL: BASE, NUXT_LOG_LEVEL: "error" },
  stdio: ["ignore", "pipe", "pipe"],
});
for (let i = 0; i < 160; i++) {
  try { if ((await fetch(BASE + "/")).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
const c = await mysql.createConnection({ ...creds, database: DB });
for (let i = 0; i < 200; i++) {
  const [r] = await c.query("SELECT 1 FROM `migrations` WHERE `id` LIKE '0027%'").catch(() => [[]]);
  if (r.length) break;
  await new Promise((r) => setTimeout(r, 250));
}

let failures = 0;
let browser;
const stop = async () => {
  await browser?.close().catch(() => {});
  child.kill("SIGKILL");
  const cleanup = await mysql.createConnection(creds);
  await cleanup.query(`DROP DATABASE IF EXISTS \`${DB}\``);
  await cleanup.end();
  await c.end();
};

try {
  const check = (name, ok, detail = "") => {
    console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? " — " + detail : ""}`);
    if (!ok) failures++;
  };

  const signUp = async (name, email) => {
    await fetch(`${BASE}/api/auth/sign-up`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, email, password: "correct horse battery" }) });
    const res = await fetch(`${BASE}/api/auth/sign-in`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "correct horse battery" }) });
    return (res.headers.getSetCookie?.() ?? []).map((x) => x.split(";")[0]).find((x) => x.startsWith("session_token="));
  };
  const owner = await signUp("Owner", "owner@example.test");
  const stranger = await signUp("Stranger", "stranger@example.test");
  const as = (cookie, path, init = {}) =>
    fetch(`${BASE}${path}`, { ...init, headers: { ...(init.headers || {}), cookie,
      ...(init.body ? { "content-type": "application/json" } : {}) } });

  const [[me]] = await c.query("SELECT id FROM `user` WHERE email = 'owner@example.test'");
  const [board] = await c.execute(
    "INSERT INTO boards (user, name, style, color, status) VALUES (?,?,?,?,?)",
    [me.id, "Kundenprojekt", "kanban", "#2563eb", "public"]);
  const boardId = board.insertId;
  for (const [i, name] of ["Todo", "Zur Vorlage", "Erledigt"].entries())
    await c.execute("INSERT INTO areas (board, name, sort) VALUES (?,?,?)", [boardId, name, i]);
  const [[first]] = await c.query("SELECT id FROM areas WHERE board = ? ORDER BY sort LIMIT 1", [boardId]);
  await c.execute("INSERT INTO cards (area, name, content, sort) VALUES (?,?,?,?)", [first.id, "Nicht mitkopieren", "", 0]);
  // An archived column is not part of the board's shape any more.
  await c.execute("INSERT INTO areas (board, name, sort, archivedAt) VALUES (?,?,?,NOW())", [boardId, "Alt", 9]);

  const response = await as(owner, "/api/data/board-duplicate", {
    method: "POST", body: JSON.stringify({ boardId, name: "Theaterprojekt" }) });
  const created = await response.json();
  check("it answers with the new board", !!created?.board?.id, JSON.stringify(created).slice(0, 90));
  const copyId = created.board.id;

  const [copyAreas] = await c.query(
    "SELECT name, sort FROM areas WHERE board = ? ORDER BY sort ASC", [copyId]);
  check("the columns come across, in order",
    copyAreas.map((a) => a.name).join(" / ") === "Todo / Zur Vorlage / Erledigt",
    JSON.stringify(copyAreas.map((a) => a.name)));
  check("an archived column does not", !copyAreas.some((a) => a.name === "Alt"));

  const [[cards]] = await c.query(
    "SELECT COUNT(*) AS total FROM cards WHERE area IN (SELECT id FROM areas WHERE board = ?)", [copyId]);
  check("and no cards at all", Number(cards.total) === 0, `${cards.total} copied`);

  const [[copy]] = await c.query("SELECT * FROM boards WHERE id = ?", [copyId]);
  check("it takes the name it was given", copy.name === "Theaterprojekt");
  check("it keeps the look", copy.style === "kanban" && copy.color === "#2563eb");
  check("it is private, whatever the original was", copy.status === "private", copy.status);
  check("and it belongs to whoever asked", copy.user === me.id);

  check("the original is untouched",
    (await c.query("SELECT COUNT(*) AS t FROM areas WHERE board = ? AND archivedAt IS NULL", [boardId]))[0][0].t === 3);

  // A public board is readable by anyone signed in, so anyone may take a copy
  // of its shape — the copy is their own board and holds nothing.
  const byStranger = await as(stranger, "/api/data/board-duplicate", {
    method: "POST", body: JSON.stringify({ boardId, name: "Fremd" }) });
  check("somebody who can see the board can copy its shape", byStranger.status === 200, `status ${byStranger.status}`);

  await c.execute("UPDATE boards SET status = 'private' WHERE id = ?", [boardId]);
  const refused = await as(stranger, "/api/data/board-duplicate", {
    method: "POST", body: JSON.stringify({ boardId, name: "Fremd" }) });
  // 404 rather than 403, and deliberately: telling a stranger "you may not
  // copy that" would confirm the board exists.
  check("somebody who cannot, cannot", refused.status === 404, `status ${refused.status}`);

  const noName = await as(owner, "/api/data/board-duplicate", {
    method: "POST", body: JSON.stringify({ boardId, name: "   " }) });
  check("a board needs a name", noName.status === 400, `status ${noName.status}`);

  // ---------------------------------------------------------------- the UI --
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.context().addCookies([{ name: "session_token", value: owner.split("=").slice(1).join("="),
    domain: "127.0.0.1", path: "/" }]);
  await page.goto(`${BASE}/board/${boardId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.locator("button[aria-haspopup='menu']").last().click();
  await page.waitForTimeout(400);
  await page.locator("button", { hasText: /Board duplizieren|Duplicate board/ }).first().click();
  await page.waitForTimeout(700);

  const field = page.locator("input[type=text]").last();
  check("the dialog opens with the board's name ready to replace",
    (await field.inputValue()) === "Kundenprojekt", await field.inputValue());
  await field.fill("Aus der Oberfläche");
  await page.locator("input[type=submit]").last().click();
  await page.waitForURL(/\/board\/\d+/, { timeout: 15000 });
  await page.waitForTimeout(1500);

  const [[fromUi]] = await c.query("SELECT id FROM boards WHERE name = 'Aus der Oberfläche'");
  check("duplicating from the board page makes the board", !!fromUi);
  check("and lands you on it", page.url().includes(`/board/${fromUi.id}`), page.url());
  const columns = await page.locator("[data-area-id]").count();
  check("with its columns already there", columns === 3, `${columns} columns`);
} catch (error) {
  console.error(`\n FAIL  the run stopped early — ${error.message.split("\n")[0]}`);
  failures++;
} finally {
  await stop();
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures ? 1 : 0);
