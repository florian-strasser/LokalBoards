// Copy buttons on code blocks, in both places they appear: the app, where a
// block comes from the editor's Codeblock button and reaches the page as a
// string of HTML through `v-html`, and the documentation site, where blocks are
// rendered by Nuxt Content — including the tabbed API examples, where the button
// must copy the language currently on show and not one of the hidden ones.
//
// Needs both builds: `npm run build` here and in docs/.
import { chromium } from "playwright";
import mysql from "mysql2/promise";
import { spawn } from "node:child_process";
import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const db = () => mysql.createConnection({
  host: env.NUXT_MYSQL_HOST, user: env.NUXT_MYSQL_USER,
  password: env.NUXT_MYSQL_PASSWORD, database: env.NUXT_MYSQL_DATABASE,
});

const APP_PORT = Number(process.env.COPY_APP_PORT || 3116);
const DOCS_PORT = Number(process.env.COPY_DOCS_PORT || 3117);
const APP = `http://127.0.0.1:${APP_PORT}`;
const DOCS = `http://127.0.0.1:${DOCS_PORT}`;

for (const [name, url] of [["app", APP], ["docs", DOCS]]) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1500) });
    console.error(`something is already listening on the ${name} port; stop it first`);
    process.exit(1);
  } catch {}
}

const sweep = async () => {
  const c = await db();
  await c.execute("DELETE FROM comments WHERE card IN (SELECT id FROM cards WHERE area IN (SELECT id FROM areas WHERE board IN (SELECT id FROM boards WHERE name = 'copy-test')))");
  await c.execute("DELETE FROM cards WHERE area IN (SELECT id FROM areas WHERE board IN (SELECT id FROM boards WHERE name = 'copy-test'))");
  await c.execute("DELETE FROM areas WHERE board IN (SELECT id FROM boards WHERE name = 'copy-test')");
  await c.execute("DELETE FROM boards WHERE name = 'copy-test'");
  for (const t of ["session", "account"]) {
    await c.execute(`DELETE FROM \`${t}\` WHERE userId IN (SELECT id FROM \`user\` WHERE email LIKE '%@example.test')`);
  }
  await c.execute("DELETE FROM `user` WHERE email LIKE '%@example.test'");
  await c.end();
};
await sweep();

const serve = async (cwd, port, extra = {}) => {
  const child = spawn("node", [".output/server/index.mjs"], {
    cwd,
    env: { ...process.env, ...env, PORT: String(port), NUXT_MYSQL_SSL: "false", ...extra },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/`)).ok) return child; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill("SIGKILL");
  throw new Error(`server in ${cwd} did not start on ${port}`);
};

const app = await serve(".", APP_PORT, { NUXT_BOARDS_URL: APP, NUXT_PUBLIC_SIGNUP: "true" });
const docs = await serve("docs", DOCS_PORT);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
};

const CODE = 'const greeting = "hello";\nconsole.log(greeting);';
const COMMENT_CODE = 'SELECT 1;';

const c = await db();
await fetch(`${APP}/api/auth/sign-up`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "Owner", email: "owner@example.test", password: "correct horse battery" }),
});
const [[owner]] = await c.execute("SELECT id FROM `user` WHERE email = 'owner@example.test'");
const signIn = await fetch(`${APP}/api/auth/sign-in`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "owner@example.test", password: "correct horse battery" }),
});
const cookie = (signIn.headers.getSetCookie?.() ?? []).map((x) => x.split(";")[0])
  .find((x) => x.startsWith("session_token="));

const [board] = await c.execute("INSERT INTO boards (`user`, name, style) VALUES (?, 'copy-test', 'kanban')", [owner.id]);
const [area] = await c.execute("INSERT INTO areas (board, name, sort) VALUES (?, 'Backlog', 0)", [board.insertId]);
const [card] = await c.execute(
  "INSERT INTO cards (area, name, sort, content) VALUES (?, 'With code', 0, ?)",
  [area.insertId, "Here is some code:\n\n```js\n" + CODE + "\n```\n"],
);
await c.execute("INSERT INTO comments (card, `user`, content) VALUES (?, ?, ?)",
  [card.insertId, owner.id, "And in a comment:\n\n```sql\n" + COMMENT_CODE + "\n```\n"]);

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  permissions: ["clipboard-read", "clipboard-write"],
});
await ctx.addCookies([{ name: "session_token", value: cookie.split("=")[1], url: APP }]);
const page = await ctx.newPage();
const clipboard = () => page.evaluate(() => navigator.clipboard.readText());

console.log("\n1. a code block in a card description");
await page.goto(`${APP}/board/${board.insertId}?card=${card.insertId}`, { waitUntil: "load" });
await page.waitForSelector(".wysiwyg-wrapper pre", { timeout: 15000 });
// The buttons are added once the page is running, a moment after the block
// itself is on screen; counting straight away raced them.
await page.waitForSelector(".wysiwyg-wrapper pre .code-copy", { timeout: 5000 }).catch(() => {});
const buttons = page.locator(".wysiwyg-wrapper pre .code-copy");
check("the block has a copy button", (await buttons.count()) >= 1, `${await buttons.count()} found`);
await buttons.first().click({ force: true });
await page.waitForTimeout(200);
check("copies the code", (await clipboard()) === CODE, JSON.stringify((await clipboard()).slice(0, 40)));
check("without a trailing newline", !(await clipboard()).endsWith("\n"));
check("it confirms itself", await buttons.first().evaluate((el) => el.classList.contains("code-copy--done")));

// The tick is at the point of the click; the toast is where the app says
// everything else that just happened.
const toastCard = page.locator("div.fixed.bottom-8.right-8 > div");
await toastCard.first().waitFor({ timeout: 3000 }).catch(() => {});
check("and raises a toast", (await toastCard.count()) >= 1, `${await toastCard.count()} toasts`);
check("saying the code was copied",
  (await toastCard.first().innerText().catch(() => "")).trim().length > 0,
  JSON.stringify((await toastCard.first().innerText().catch(() => "")).trim()));

console.log("\n2. and one in a comment");
const commentButton = page.locator(".comment-content-container .code-copy").first();
check("has its own button", (await commentButton.count()) >= 1);
if (await commentButton.count()) {
  await commentButton.click({ force: true });
  await page.waitForTimeout(200);
  check("copies that block, not the description's", (await clipboard()) === COMMENT_CODE, JSON.stringify(await clipboard()));
}

console.log("\n3. the documentation's tabbed examples copy the selected language");
const docPage = await ctx.newPage();
await docPage.goto(`${DOCS}/api/areas`, { waitUntil: "load" });
await docPage.waitForTimeout(600);
const clip = () => docPage.evaluate(() => navigator.clipboard.readText());
const tabs = docPage.locator(".code-example__tabs button");
// Only the visible panel is laid out, so this is the button on show.
const shown = () => docPage.locator(".code-example__body > div:visible .prose-pre__copy").first();
await shown().click({ force: true });
const first = await clip();
check("copies the first tab", first.trimStart().startsWith("curl"), JSON.stringify(first.slice(0, 30)));
await tabs.filter({ hasText: "PHP" }).first().click();
await docPage.waitForTimeout(250);
await shown().click({ force: true });
const php = await clip();
check("copies PHP after switching to it", php.includes("<?php"), JSON.stringify(php.slice(0, 30)));
check("and no longer the cURL snippet", !php.trimStart().startsWith("curl"));

console.log("\n4. a plain block on a documentation page");
await docPage.goto(`${DOCS}/docs`, { waitUntil: "load" });
await docPage.waitForTimeout(600);
const plain = docPage.locator(".prose-pre__copy").first();
check("has a copy button", (await plain.count()) >= 1);
await plain.click({ force: true });
check("copies it", (await clip()).length > 0, JSON.stringify((await clip()).slice(0, 40)));

await c.end();
await browser.close();
for (const child of [app, docs]) {
  await new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill("SIGTERM");
    setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5000);
  });
}
await sweep();
console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures ? 1 : 0);
