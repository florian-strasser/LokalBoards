// Selecting text never closes what the text is in.
//
// A customer selected a sentence in a card's editor to delete it, and because
// the drag carried the pointer out over the dimmed page, letting go closed the
// card. A
// click is reported on the nearest element that holds both ends of the press,
// and for a press inside the card and a release beside it, that element is the
// area around the card — the one that closes it on a click. The search results
// and the notifications panel close on "a click outside" and fell for the same
// thing: select what you typed into the search, let go below the field, and the
// results were gone.
//
// So, in Chromium and WebKit: drag a selection from inside each of them to
// outside and let go — it stays open. Press outside and let go inside — it
// stays open too, because that was not a click beside it either. A plain click
// outside still closes all three, which is the behaviour that has to survive.
//
// Requires a built app (`npm run build`) and the credentials in `.env.local`.
// Creates and drops a database of its own.
import fs from "node:fs";
import { spawn } from "node:child_process";
import mysql from "mysql2/promise";
import { chromium, webkit } from "playwright";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const DB = "lokalboards_selectdrag";
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

const SENTENCE = "This sentence is long enough to select a part of it by dragging across it.";

try {
  const check = (name, ok, detail = "") => {
    console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? " — " + detail : ""}`);
    if (!ok) failures++;
  };

  await fetch(`${BASE}/api/auth/sign-up`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Florian", email: "owner@example.test", password: "correct horse battery" }) });
  const signIn = await fetch(`${BASE}/api/auth/sign-in`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "owner@example.test", password: "correct horse battery" }) });
  const token = (signIn.headers.getSetCookie?.() ?? []).map((x) => x.split(";")[0])
    .find((x) => x.startsWith("session_token=")).split("=").slice(1).join("=");
  const [[owner]] = await c.query("SELECT id FROM `user` WHERE email = ?", ["owner@example.test"]);
  await c.query("UPDATE `user` SET onboarded = 1 WHERE id = ?", [owner.id]);

  const [board] = await c.execute("INSERT INTO boards (user, name, status) VALUES (?,?,?)", [owner.id, "Writing", "private"]);
  const [area] = await c.execute("INSERT INTO areas (board, name, sort) VALUES (?,?,?)", [board.insertId, "Todo", 0]);
  const [card] = await c.execute("INSERT INTO cards (area, name, content, sort) VALUES (?,?,?,?)",
    [area.insertId, "Draft", SENTENCE, 0]);
  const boardUrl = `${BASE}/board/${board.insertId}`;
  const cardUrl = `${boardUrl}?card=${card.insertId}`;

  // Pressing, moving in steps and letting go, the way a hand does: a single
  // jump would not select anything along the way.
  const drag = async (page, from, to) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(700);
  };
  const cardOpen = (page) => new URL(page.url()).searchParams.get("card") === String(card.insertId);
  const selected = (page) => page.evaluate(() => String(window.getSelection()));

  for (const [name, engine] of [["Chromium", chromium], ["WebKit", webkit]]) {
    console.log(`\n${name}`);
    browser = await engine.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addCookies([{ name: "session_token", value: token, domain: "127.0.0.1", path: "/" }]);
    const page = await context.newPage();

    // --- The card ---------------------------------------------------------
    // Opened and put into editing, which is where it happened: a selection
    // made in the description's editor, carried out over the dimmed page.
    const editCard = async () => {
      await page.goto(cardUrl, { waitUntil: "networkidle" });
      await page.waitForTimeout(1200);
      await page.getByRole("button", { name: "Edit description" }).click();
      const editor = page.locator(".ProseMirror", { hasText: SENTENCE }).first();
      await editor.waitFor();
      // On the first line of the sentence itself, not in the editor's padding.
      const line = await editor.locator("p").first().boundingBox();
      const dialog = await page.locator(".shadow-xl.rounded-lg", { has: editor }).first().boundingBox();
      return {
        inText: { x: line.x + line.width * 0.3, y: line.y + 8 },
        beside: { x: dialog.x + dialog.width + 120, y: line.y + 8 },
      };
    };

    let at = await editCard();
    await drag(page, at.inText, at.beside);
    const picked = await selected(page);
    check("a selection in the editor dragged out beside the card keeps the card open",
      cardOpen(page), `selected "${picked.slice(0, 30)}…"`);
    check("and the text it went across is still selected", picked.length > 10);

    // Each of these starts from a freshly opened card, so one failure cannot
    // make the next one pass or fail on a board with no card over it.
    at = await editCard();
    await drag(page, at.inText, { x: 640, y: 12 });
    check("so does one carried up onto the backdrop above it", cardOpen(page));

    at = await editCard();
    await drag(page, at.inText, { x: 8, y: 890 });
    check("and one let go in the far corner of the window", cardOpen(page));

    at = await editCard();
    await drag(page, at.beside, at.inText);
    check("pressing beside the card and letting go inside it keeps it open", cardOpen(page));

    at = await editCard();
    await page.mouse.click(at.beside.x, at.beside.y);
    await page.waitForTimeout(900);
    check("a plain click beside the card still closes it", !cardOpen(page), page.url());

    // Above the card is the backdrop proper rather than the space the card
    // scrolls in; it closes the card the same way.
    await editCard();
    await page.mouse.click(640, 12);
    await page.waitForTimeout(900);
    check("and so does one on the backdrop above it", !cardOpen(page), page.url());

    // --- The search results -----------------------------------------------
    await page.goto(boardUrl, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const field = page.locator('input[type="search"]').first();
    await field.click();
    await page.keyboard.type("sentence");
    const results = page.locator("body > div.fixed.z-50", { hasText: "Draft" });
    await results.waitFor({ timeout: 5000 }).catch(() => {});
    check("searching shows the results", await results.isVisible());

    const fieldBox = await field.boundingBox();
    await drag(page,
      { x: fieldBox.x + fieldBox.width - 30, y: fieldBox.y + fieldBox.height / 2 },
      { x: fieldBox.x - 60, y: fieldBox.y + fieldBox.height + 80 });
    check("selecting what was typed and letting go outside the field keeps the results", await results.isVisible());

    await page.mouse.click(8, 890);
    await page.waitForTimeout(500);
    check("a plain click elsewhere still puts them away", !(await results.isVisible()));

    // --- The notifications ------------------------------------------------
    await page.locator('button[aria-label="Notifications"]').first().click();
    const panel = page.locator("body > div.fixed.z-50", { has: page.locator("h3") });
    await panel.waitFor({ timeout: 5000 }).catch(() => {});
    check("the bell opens its panel", await panel.isVisible());

    const heading = await panel.locator("h3").boundingBox();
    await drag(page,
      { x: heading.x + 4, y: heading.y + heading.height / 2 },
      { x: heading.x - 200, y: heading.y + 300 });
    check("selecting its heading and letting go outside keeps it open", await panel.isVisible());

    await page.mouse.click(8, 890);
    await page.waitForTimeout(500);
    check("a plain click elsewhere still closes it", !(await panel.isVisible()));

    await browser.close();
    browser = undefined;
  }
} catch (error) {
  console.error(`\n FAIL  the run stopped early — ${error.message.split("\n")[0]}`);
  failures++;
} finally {
  await stop();
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures ? 1 : 0);
