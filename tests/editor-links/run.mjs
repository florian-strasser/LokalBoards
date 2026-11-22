// A link in a card's description ends where its address ends.
//
// The editor's link mark used to be inclusive: text typed right after a link,
// or in front of one that opens the paragraph, became part of it — so a
// description that started with an address could end up as one long link,
// stored as `[https://… and the rest of the text](https://…)`. Clicking into it
// to fix it opened the address instead, and nothing in the toolbar took a link
// away. This types around links, repairs such a description with the link
// button, and checks that typing an address still makes a link of it.
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
const DB = "lokalboards_links";
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

  await fetch(`${BASE}/api/auth/sign-up`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Owner", email: "owner@example.test", password: "correct horse battery" }) });
  const signIn = await fetch(`${BASE}/api/auth/sign-in`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "owner@example.test", password: "correct horse battery" }) });
  const cookie = (signIn.headers.getSetCookie?.() ?? []).map((x) => x.split(";")[0])
    .find((x) => x.startsWith("session_token="));

  const [[me]] = await c.query("SELECT id FROM `user` LIMIT 1");
  await c.query("UPDATE `user` SET onboarded = 1 WHERE id = ?", [me.id]);
  const [board] = await c.execute("INSERT INTO boards (user, name, status) VALUES (?,?,?)", [me.id, "Links", "private"]);
  const boardId = board.insertId;
  const [area] = await c.execute("INSERT INTO areas (board, name, sort) VALUES (?,?,?)", [boardId, "Todo", 0]);
  const card = async (content) => {
    const [row] = await c.execute("INSERT INTO cards (area, name, content, sort) VALUES (?,?,?,?)",
      [area.insertId, "Links", content, 0]);
    return row.insertId;
  };
  const stored = async (id) => String((await c.query("SELECT content FROM cards WHERE id = ?", [id]))[0][0].content ?? "");

  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: "session_token", value: cookie.split("=").slice(1).join("="),
    domain: "127.0.0.1", path: "/" }]);
  const page = await context.newPage();

  const openEditor = async (id) => {
    await page.goto(`${BASE}/board/${boardId}?card=${id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    const edit = page.locator("button", { hasText: /Edit description/ }).first();
    if (await edit.count()) {
      await edit.click();
      await page.waitForTimeout(600);
    }
  };
  const save = async () => {
    await page.locator("button", { hasText: /^\s*Save\s*$/ }).first().click();
    await page.waitForTimeout(1500);
  };
  const links = () => page.locator(".tiptap a").evaluateAll((nodes) => nodes.map((n) => n.textContent));
  // The caret at the very start or end of the description, by keyboard.
  const caretTo = async (where) => {
    await page.evaluate((where) => {
      const root = document.querySelector(".tiptap");
      root.focus();
      const range = document.createRange();
      range.selectNodeContents(root.querySelector("p"));
      range.collapse(where === "start");
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }, where);
    await page.waitForTimeout(100);
  };

  // ------------------------------------------------- typing after a link ----
  console.log("\ntyping next to a link");
  const after = await card("https://example.com");
  await openEditor(after);
  await caretTo("end");
  await page.keyboard.type(" is where the docs are");
  let seen = await links();
  check("text typed right after a link is not part of it", seen.length === 1 && seen[0] === "https://example.com",
    JSON.stringify(seen));
  await save();
  let content = await stored(after);
  check("and is stored outside it", content.includes("is where the docs are") && !/\[[^\]]*docs[^\]]*\]\(/.test(content),
    JSON.stringify(content));

  const before = await card("https://example.com is where the docs are");
  await openEditor(before);
  await caretTo("start");
  await page.keyboard.type("Look: ");
  seen = await links();
  check("text typed in front of a link that opens the description is not part of it",
    seen.length === 1 && seen[0] === "https://example.com", JSON.stringify(seen));
  await save();
  content = await stored(before);
  check("and is stored outside it", content.startsWith("Look: ") && !/\[Look/.test(content), JSON.stringify(content));

  // ------------------------------------------------ typing a new address ----
  console.log("\ntyping an address");
  const typed = await card("");
  await openEditor(typed);
  await page.locator(".tiptap").first().click();
  await page.keyboard.type("https://lokalboards.com and then some more words");
  seen = await links();
  check("an address typed and followed by a space becomes a link of exactly that address",
    seen.length === 1 && seen[0] === "https://lokalboards.com", JSON.stringify(seen));

  // ----------------------------------------- repairing a link run too far ----
  console.log("\nrepairing a description that is one long link");
  const broken = await card("[https://example.com and all the rest of the text](https://example.com)");
  await openEditor(broken);
  const pagesBefore = context.pages().length;
  await page.locator(".tiptap a").first().click({ position: { x: 200, y: 6 } });
  await page.waitForTimeout(800);
  check("clicking into a link while editing puts the caret there instead of opening it",
    context.pages().length === pagesBefore, `${context.pages().length - pagesBefore} page(s) opened`);
  const linkButton = page.locator(".editor-toolbar button:has(svg.lucide-link)");
  check("the link button shows the caret is in a link",
    (await linkButton.getAttribute("class") ?? "").includes("text-primary"));
  await linkButton.click();
  await page.waitForTimeout(300);
  seen = await links();
  check("and takes the link away", seen.length === 0, JSON.stringify(seen));
  await save();
  content = await stored(broken);
  check("what is stored is the text, without the long link", content === "https://example.com and all the rest of the text",
    JSON.stringify(content));
  const shown = await page.locator(".wysiwyg-wrapper a").evaluateAll((nodes) => nodes.map((n) => n.textContent));
  check("and the card shows the address alone as a link again", shown.length === 1 && shown[0] === "https://example.com",
    JSON.stringify(shown));

  // ------------------------------------------------------ making a link ----
  console.log("\nmaking a link");
  const made = await card("Read the manual first");
  await openEditor(made);
  await page.evaluate(() => {
    const p = document.querySelector(".tiptap p");
    const text = p.firstChild;
    const range = document.createRange();
    range.setStart(text, 9);
    range.setEnd(text, 15);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.waitForTimeout(150);
  page.once("dialog", (dialog) => dialog.accept("https://www.lokalboards.com/docs"));
  await page.locator(".editor-toolbar button:has(svg.lucide-link)").click();
  await page.waitForTimeout(300);
  seen = await links();
  check("the link button makes a link of the selected words", seen.length === 1 && seen[0] === "manual", JSON.stringify(seen));
  await save();
  content = await stored(made);
  check("and it is stored as one", content === "Read the [manual](https://www.lokalboards.com/docs) first", JSON.stringify(content));

  const bare = await card("");
  await openEditor(bare);
  await page.locator(".tiptap").first().click();
  page.once("dialog", (dialog) => dialog.accept("lokalboards.com"));
  await page.locator(".editor-toolbar button:has(svg.lucide-link)").click();
  await page.waitForTimeout(300);
  const put = await page.locator(".tiptap a").evaluateAll((nodes) => nodes.map((n) => [n.textContent, n.getAttribute("href")]));
  check("with nothing selected it puts the address in as a link, a web address when it has no scheme",
    put.length === 1 && put[0][0] === "https://lokalboards.com" && put[0][1] === "https://lokalboards.com", JSON.stringify(put));

  const unsafe = await card("Click here");
  await openEditor(unsafe);
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(".tiptap p"));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.waitForTimeout(150);
  page.once("dialog", (dialog) => dialog.accept("javascript:alert(1)"));
  await page.locator(".editor-toolbar button:has(svg.lucide-link)").click();
  await page.waitForTimeout(300);
  seen = await links();
  check("an address that is not one is not linked", seen.length === 0, JSON.stringify(seen));
} catch (error) {
  console.error(`\n FAIL  the run stopped early — ${error.message.split("\n")[0]}`);
  failures++;
} finally {
  await stop();
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures ? 1 : 0);
