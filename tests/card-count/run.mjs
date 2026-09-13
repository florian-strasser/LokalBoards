// Dragging a card to another area keeps the counts honest.
//
// SortableJS moves the element in the DOM, and the board's data used to be left
// where it was — so the area headers, which count the data, said a column held
// one card while it plainly held two. It was only ever wrong for the person
// dragging: a move from the card's dialog, or one arriving from somebody else,
// already updated the data. This drags with a real pointer and checks the
// headers, that no tile is drawn twice, and that the server agrees.
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
const DB = "lokalboards_cardcount";
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
const c = await mysql.createConnection({ ...creds, database: DB });
for (let i = 0; i < 200; i++) {
  const [r] = await c.query("SELECT 1 FROM `migrations` WHERE `id` LIKE '0028%'").catch(() => [[]]);
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

  await fetch(`${BASE}/api/auth/sign-up`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Owner", email: "owner@example.test", password: "correct horse battery" }) });
  const signIn = await fetch(`${BASE}/api/auth/sign-in`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "owner@example.test", password: "correct horse battery" }) });
  const cookie = (signIn.headers.getSetCookie?.() ?? []).map((x) => x.split(";")[0])
    .find((x) => x.startsWith("session_token="));

  const [[me]] = await c.query("SELECT id FROM `user` LIMIT 1");
  const [board] = await c.execute("INSERT INTO boards (user, name, status) VALUES (?,?,?)", [me.id, "LokalTransfer", "private"]);
  const boardId = board.insertId;
  const [todo] = await c.execute("INSERT INTO areas (board, name, sort) VALUES (?,?,?)", [boardId, "Todo", 0]);
  const [done] = await c.execute("INSERT INTO areas (board, name, sort) VALUES (?,?,?)", [boardId, "Done", 1]);
  const [website] = await c.execute("INSERT INTO cards (area, name, content, sort) VALUES (?,?,?,?)", [todo.insertId, "Website", "", 0]);
  const [docs] = await c.execute("INSERT INTO cards (area, name, content, sort) VALUES (?,?,?,?)", [todo.insertId, "Docs", "", 1]);
  const [release] = await c.execute("INSERT INTO cards (area, name, content, sort) VALUES (?,?,?,?)", [done.insertId, "Public Release", "", 0]);

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.context().addCookies([{ name: "session_token", value: cookie.split("=").slice(1).join("="),
    domain: "127.0.0.1", path: "/" }]);

  // What each column says about itself, and what it actually draws. Read from
  // the DOM rather than by attribute selector: the area name is a v-model input,
  // and v-model sets the property, not the attribute.
  const columns = () => page.evaluate(() =>
    Object.fromEntries([...document.querySelectorAll("[data-area-id]")].map((wrapper) => {
      const column = wrapper.parentElement;
      return [column.querySelector("input")?.value, {
        says: column.querySelector("span.tabular-nums")?.textContent.trim() ?? "",
        draws: wrapper.querySelectorAll("[data-card-id]").length,
      }];
    })));
  const onPage = (cardId) => page.evaluate((id) =>
    document.querySelectorAll(`[data-card-id="${id}"]`).length, cardId);

  const drag = async (fromSelector, toSelector) => {
    const from = await page.locator(fromSelector).boundingBox();
    const to = await page.locator(toSelector).boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, from.y + 20, { steps: 5 });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height - 4, { steps: 20 });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height - 3, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(1200);
  };

  await page.goto(`${BASE}/board/${boardId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  const before = await columns();
  check("the headers start out right", before.Todo?.says === "2" && before.Done?.says === "1", JSON.stringify(before));

  // ------------------------------------------------- across areas ---------
  await drag(`[data-card-id="${docs.insertId}"]`, `[data-area-id="${done.insertId}"]`);

  const after = await columns();
  check("the area it left counts one fewer", after.Todo?.says === "1", JSON.stringify(after.Todo));
  check("the area it joined counts one more", after.Done?.says === "2", JSON.stringify(after.Done));
  check("each header agrees with what is drawn under it",
    Number(after.Todo?.says) === after.Todo?.draws && Number(after.Done?.says) === after.Done?.draws,
    JSON.stringify(after));
  check("the card is drawn exactly once, not left behind or doubled",
    (await onPage(docs.insertId)) === 1, `${await onPage(docs.insertId)} on the page`);

  const [[moved]] = await c.query("SELECT area FROM cards WHERE id = ?", [docs.insertId]);
  check("and the server moved it too", Number(moved.area) === done.insertId, `area ${moved.area}`);

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const reloaded = await columns();
  check("a reload shows the same counts the drag did",
    reloaded.Todo?.says === "1" && reloaded.Done?.says === "2", JSON.stringify(reloaded));

  // --------------------------------------------------- within an area ------
  await drag(`[data-card-id="${release.insertId}"]`, `[data-area-id="${done.insertId}"]`);
  const reordered = await columns();
  check("reordering inside an area leaves its count alone", reordered.Done?.says === "2", JSON.stringify(reordered.Done));
  check("and still draws each card once",
    (await onPage(release.insertId)) === 1 && (await onPage(docs.insertId)) === 1);

  // ------------------------------------------------------ and back again ---
  await drag(`[data-card-id="${docs.insertId}"]`, `[data-area-id="${todo.insertId}"]`);
  const back = await columns();
  check("moving it back restores both counts",
    back.Todo?.says === "2" && back.Done?.says === "1", JSON.stringify(back));
  check("with nothing drawn twice anywhere",
    back.Todo?.draws === 2 && back.Done?.draws === 1, JSON.stringify(back));
  check("the untouched card never moved", (await onPage(website.insertId)) === 1);
} catch (error) {
  console.error(`\n FAIL  the run stopped early — ${error.message.split("\n")[0]}`);
  failures++;
} finally {
  await stop();
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures ? 1 : 0);
