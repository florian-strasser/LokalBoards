// My work on the dashboard, and a board's filter in its address.
//
// My work: the open cards assigned to you, across the boards you can still see,
// grouped by when they are due. Checked through the API for what is and is not
// included, and in a browser for the groups, the switch and the way into a card.
//
// The filter: a board opened from a filtered link shows exactly that, a filter
// picked by hand goes into the address without adding to the history, and the
// open card and the filter share the address without stepping on each other.
//
// Requires a built app (`npm run build`) and the credentials in `.env.local`.
// Creates and drops a database of its own. Screenshots go to $SHOTS if set.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import mysql from "mysql2/promise";
import { chromium } from "playwright";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const DB = "lokalboards_myworktest";
const PORT = 3100, BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.SHOTS;
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
for (let i = 0; i < 200; i++) {
  const [r] = await c.query("SELECT 1 FROM `migrations` WHERE `id` LIKE '0028%'").catch(() => [[]]);
  if (r.length) break;
  await new Promise((r) => setTimeout(r, 250));
}

let failures = 0;
let browser;
let page;
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
    return { id: row.id, cookie };
  };
  const me = await account("Florian", "me@example.test");
  const colleague = await account("Anna", "anna@example.test");

  const DAY = 86400000;
  const inDays = (days, hour = 10) => {
    const d = new Date(); d.setHours(hour, 0, 0, 0);
    return new Date(d.getTime() + days * DAY);
  };

  const board = async (name, owner, extra = {}) => {
    const [row] = await c.execute("INSERT INTO boards (user, name, status, archivedAt) VALUES (?,?,?,?)", [owner.id, name, "private", extra.archivedAt ?? null]);
    return row.insertId;
  };
  const area = async (boardId, name, sort = 0, archivedAt = null) =>
    (await c.execute("INSERT INTO areas (board, name, sort, archivedAt) VALUES (?,?,?,?)", [boardId, name, sort, archivedAt]))[0].insertId;
  const card = async (areaId, name, fields = {}) =>
    (await c.execute("INSERT INTO cards (area, name, content, sort, status, dueDate, assignee, archivedAt) VALUES (?,?,?,?,?,?,?,?)",
      [areaId, name, fields.content ?? "", fields.sort ?? 0, fields.status ?? 0, fields.dueDate ?? null, fields.assignee ?? null, fields.archivedAt ?? null]))[0].insertId;

  // Mine, shared with Anna.
  const website = await board("Website", me);
  await c.execute("INSERT INTO invitations (board, user, permission) VALUES (?,?,?)", [website, colleague.id, "edit"]);
  const todo = await area(website, "Todo", 0);
  const doing = await area(website, "Doing", 1);
  const late = await card(todo, "Fix the contact form", { assignee: me.id, dueDate: inDays(-2), content: "- [x] one\n- [ ] two" });
  const soon = await card(doing, "Write the launch post", { assignee: me.id, dueDate: inDays(2), sort: 1 });
  const someday = await card(todo, "Redesign the footer", { assignee: me.id, sort: 2 });
  const anna = await card(todo, "Anna's card", { assignee: colleague.id, dueDate: inDays(1), sort: 3 });
  const unassigned = await card(todo, "Nobody's card", { sort: 4 });
  const finished = await card(doing, "Already done", { assignee: me.id, status: 1, dueDate: inDays(-1) });
  const thrown = await card(todo, "Archived card", { assignee: me.id, archivedAt: new Date(), sort: 5 });
  const oldArea = await area(website, "Old", 2, new Date());
  await card(oldArea, "In an archived area", { assignee: me.id });

  // Mine alone; Anna is not on it, even though a card there names her.
  const personal = await board("Personal", me);
  const personalArea = await area(personal, "List");
  const faraway = await card(personalArea, "Renew passport", { assignee: me.id, dueDate: inDays(40) });
  await card(personalArea, "Assigned to Anna on a board she cannot see", { assignee: colleague.id });

  const shelved = await board("Shelved", me, { archivedAt: new Date() });
  await card(await area(shelved, "List"), "On an archived board", { assignee: me.id });

  const [label] = await c.execute("INSERT INTO labels (board, name, color) VALUES (?,?,?)", [website, "Urgent", "#0066cc"]);
  await c.execute("INSERT INTO card_labels (card, label) VALUES (?,?), (?,?)", [late, label.insertId, anna, label.insertId]);

  // ---------------------------------------------------------------- API ----
  const work = async (who) => (await (await fetch(`${BASE}/api/data/my-work`, { headers: { cookie: who.cookie } })).json()).cards;
  const mine = await work(me);
  check("my work lists exactly the open cards on me on boards I can see",
    JSON.stringify(mine.map((x) => x.id)) === JSON.stringify([late, soon, faraway, someday]),
    mine.map((x) => x.name).join(" | "));
  check("leaving out done cards, archived ones, and anything on an archived area or board",
    ![finished, thrown].some((id) => mine.some((x) => x.id === id)) && !mine.some((x) => /archived/i.test(x.name)));
  check("each says where it is", mine[0].boardName === "Website" && mine[0].areaName === "Todo" && mine[1].areaName === "Doing");
  check("with its labels and checklist", mine[0].labels?.[0]?.name === "Urgent" && mine[0].checklist?.done === 1 && mine[0].checklist?.total === 2);
  check("and nobody else's work", !mine.some((x) => x.id === anna || x.id === unassigned));
  const hers = await work(colleague);
  check("Anna sees her card on the board she is on, and not the one on a board she is not",
    hers.length === 1 && hers[0].id === anna, hers.map((x) => x.name).join(" | "));
  const signedOut = await fetch(`${BASE}/api/data/my-work`);
  check("signed out, there is nothing", signedOut.status === 403, `status ${signedOut.status}`);

  // ------------------------------------------------------------ browser ----
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: "session_token", value: me.cookie.split("=").slice(1).join("="), domain: "127.0.0.1", path: "/" }]);
  page = await context.newPage();

  await page.goto(`${BASE}/dashboard/?view=mine`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-work-group]", { timeout: 10000 });
  const groups = await page.evaluate(() =>
    [...document.querySelectorAll("[data-work-group]")].map((section) => ({
      key: section.dataset.workGroup,
      cards: [...section.querySelectorAll("[data-card-id]")].map((el) => Number(el.dataset.cardId)),
    })));
  check("the dashboard groups my work into overdue, this week and later",
    JSON.stringify(groups) === JSON.stringify([
      { key: "overdue", cards: [late] },
      { key: "week", cards: [soon] },
      { key: "later", cards: [faraway, someday] },
    ]), JSON.stringify(groups));
  const current = await page.evaluate(() => document.querySelector("h1 [aria-current='page']")?.textContent.trim());
  check("and the heading says which view this is", current === "My work", current);
  check("there is no new entry in the navigation", (await page.locator("header a[href*='view=mine']").count()) === 0);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "my-work.png"), fullPage: true });

  await page.click(`[data-card-id="${soon}"]`);
  await page.waitForURL((url) => url.pathname.startsWith(`/board/${website}`) && url.searchParams.get("card") === String(soon), { timeout: 10000 });
  check("a card opens on its board", true);

  await page.goto(`${BASE}/dashboard/?view=mine`, { waitUntil: "networkidle" });
  await page.click("h1 a:has-text('Boards')");
  await page.waitForTimeout(800);
  check("Boards switches back to the boards", page.url().endsWith("/dashboard/") && (await page.locator("[data-work-group]").count()) === 0, page.url());

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${BASE}/dashboard/?view=mine`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-work-group]");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("on a phone nothing runs off the side", overflow <= 0, `${overflow}px`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "my-work-mobile.png"), fullPage: true });
  const headingOnPhone = await page.evaluate(() => [...document.querySelectorAll("h1 > span")].find((el) => el.offsetParent !== null)?.textContent.trim());
  check("on a phone the heading names only the view it shows", headingOnPhone === "My work", headingOnPhone);
  await page.click("label:has(input[name='dashboardView'][value='boards'])");
  await page.waitForURL((url) => url.pathname === "/dashboard/" && !url.searchParams.get("view"), { timeout: 10000 });
  await page.waitForTimeout(600);
  const phoneAfter = await page.evaluate(() => ({
    heading: [...document.querySelectorAll("h1 > span")].find((el) => el.offsetParent !== null)?.textContent.trim(),
    groups: document.querySelectorAll("[data-work-group]").length,
  }));
  check("and the switch under it goes to Boards", phoneAfter.heading === "Boards" && phoneAfter.groups === 0, JSON.stringify(phoneAfter));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "boards-mobile.png") });
  await page.setViewportSize({ width: 1280, height: 900 });

  // -------------------------------------------------- the filter in a link --
  const visible = () => page.evaluate(() =>
    [...document.querySelectorAll("[data-card-id]")].filter((el) => !el.classList.contains("hidden")).map((el) => Number(el.dataset.cardId)).sort((a, b) => a - b));
  const filterActive = () => page.evaluate(() => document.querySelector("button[aria-label='Filters']")?.classList.contains("bg-primary"));
  const boardUrl = `${BASE}/board/${website}/`;
  const openOnBoard = [late, soon, someday, anna, unassigned, finished].sort((a, b) => a - b);

  await page.goto(`${boardUrl}?labels=${label.insertId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  check("a link with a label opens the board showing only that label", JSON.stringify(await visible()) === JSON.stringify([late, anna].sort((a, b) => a - b)), JSON.stringify(await visible()));
  check("with the filter button showing it is filtering", await filterActive());

  await page.goto(`${boardUrl}?assignee=none`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  check("assignee=none is the unassigned cards", JSON.stringify(await visible()) === JSON.stringify([unassigned]), JSON.stringify(await visible()));

  await page.goto(`${boardUrl}?status=done`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  check("status=done is the done cards", JSON.stringify(await visible()) === JSON.stringify([finished]), JSON.stringify(await visible()));

  await page.goto(`${boardUrl}?assignee=${me.id}&due=overdue&status=open`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  check("the parts combine", JSON.stringify(await visible()) === JSON.stringify([late]), JSON.stringify(await visible()));

  await page.goto(`${boardUrl}?labels=abc,-1&due=soon&status=maybe`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  check("a link with nothing usable in it opens the board unfiltered",
    JSON.stringify(await visible()) === JSON.stringify(openOnBoard) && !(await filterActive()), JSON.stringify(await visible()));

  // By hand, from a board reached from the dashboard.
  await page.goto(`${BASE}/dashboard/`, { waitUntil: "networkidle" });
  await page.goto(boardUrl, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const historyBefore = await page.evaluate(() => history.length);
  await page.click("button[aria-label='Filters']");
  await page.click("button.label-pill:has-text('Urgent')");
  await page.waitForTimeout(500);
  check("picking a label puts it in the address", new URL(page.url()).searchParams.get("labels") === String(label.insertId), page.url());
  await page.click("button:has-text('Overdue')");
  await page.waitForTimeout(500);
  check("and a second part joins it", new URL(page.url()).searchParams.get("due") === "overdue", page.url());
  check("without adding to the history", (await page.evaluate(() => history.length)) === historyBefore);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "filter-in-url.png") });
  await page.keyboard.press("Escape");
  await page.mouse.click(5, 450);
  await page.waitForTimeout(300);

  await page.click(`[data-card-id="${late}"]`);
  await page.waitForTimeout(800);
  const withCard = new URL(page.url()).searchParams;
  check("opening a card keeps the filter in the address", withCard.get("card") === String(late) && withCard.get("labels") === String(label.insertId), page.url());
  await page.goBack();
  await page.waitForTimeout(800);
  const afterClose = new URL(page.url()).searchParams;
  check("and closing it leaves the filter there", !afterClose.get("card") && afterClose.get("labels") === String(label.insertId) && (await filterActive()), page.url());
  // Back used to take the card out of the dialog and leave the dialog: an empty
  // white box over a dimmed board that swallowed every click.
  await page.waitForTimeout(600);
  const dialogGone = await page.evaluate(() =>
    [...document.querySelectorAll(".modal-backdrop")].every((backdrop) => backdrop.parentElement.classList.contains("translate-x-full")));
  check("and Back closes the card's dialog, not just what was in it", dialogGone);

  await page.click("button[aria-label='Filters']");
  await page.click("button:has-text('Clear filters')");
  await page.waitForTimeout(500);
  const cleared = new URL(page.url());
  check("clearing the filter clears the address", ![...cleared.searchParams.keys()].some((k) => ["labels", "assignee", "due", "status"].includes(k)), page.url());
  check("and every card is back", JSON.stringify(await visible()) === JSON.stringify(openOnBoard));

  await page.goBack();
  await page.waitForTimeout(800);
  check("Back leaves the board instead of undoing one chip at a time", new URL(page.url()).pathname === "/dashboard/", page.url());
} catch (error) {
  console.error(`\n FAIL  the run stopped early — ${error.message.split("\n")[0]}`);
  if (SHOTS && page) await page.screenshot({ path: path.join(SHOTS, "failure.png") }).catch(() => {});
  failures++;
} finally {
  await stop();
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures ? 1 : 0);
