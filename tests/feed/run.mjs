// Activity on the dashboard: your notifications on a page of their own.
//
// The page is the bell's list without the bell's small panel — the same rows
// (NotificationItem), the same pages, the same unread dots. Checked here: the
// ways there — the bell is a link to it, though a plain click still opens the
// panel, and the panel has "Show all" — that the page shows what the bell
// shows and draws it the same way, that it goes further back a page at a time,
// the way into a card and back, and the layout on a phone.
//
// Requires a built app (`npm run build`) and the credentials in `.env.local`.
// Creates and drops a database of its own. Screenshots go to $SHOTS if set.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import mysql from "mysql2/promise";
import { chromium, webkit } from "playwright";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const DB = "lokalboards_feedtest";
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
// The app's own connections run in UTC; so does this one, or the times written
// here would be read back an offset away from the ones the app writes.
await c.query("SET time_zone = '+00:00'");
for (let i = 0; i < 200; i++) {
  const [r] = await c.query("SELECT 1 FROM `migrations` WHERE `id` LIKE '0036%'").catch(() => [[]]);
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
  const anna = await account("Anna", "anna@example.test");
  const quiet = await account("Quiet", "quiet@example.test");

  const [boardRow] = await c.execute("INSERT INTO boards (user, name, status) VALUES (?,?,?)", [me.id, "Website", "private"]);
  const website = boardRow.insertId;
  await c.execute("INSERT INTO invitations (board, user, permission) VALUES (?,?,?)", [website, anna.id, "edit"]);
  const todo = (await c.execute("INSERT INTO areas (board, name, sort) VALUES (?,?,0)", [website, "Todo"]))[0].insertId;
  const form = (await c.execute("INSERT INTO cards (area, name, sort) VALUES (?,?,0)", [todo, "Fix the contact form"]))[0].insertId;

  // Mine: one of each kind the bell knows, newest first, then enough card moves
  // to need a second and a third page, an hour apart going back.
  const HOUR = 3600000;
  const at = (hoursAgo) => new Date(Date.now() - hoursAgo * HOUR);
  const notify = async (who, type, message, hoursAgo, { actor = anna, cardId = form, isRead = 0 } = {}) =>
    (await c.execute(
      "INSERT INTO notifications (userId, type, boardId, cardId, message, isRead, createdAt, actorId) VALUES (?,?,?,?,?,?,?,?)",
      [who.id, type, website, cardId, message, isRead, at(hoursAgo), actor?.id ?? null],
    ))[0].insertId;
  await notify(me, "comment", 'New comment by "Anna" on card "Fix the contact form": <p>Looks <strong>good</strong> to me</p>', 1);
  await notify(me, "card_moved", 'Card "Fix the contact form" moved from "Todo" to "Doing"', 2, { isRead: 1 });
  await notify(me, "card_status_changed", 'Card "Fix the contact form" status changed to completed', 3);
  await notify(me, "card_assigned", '"Anna" assigned you the card "Fix the contact form"', 4);
  await notify(me, "card_due", `Card "Fix the contact form" is due on ${at(-24).toISOString()}`, 5, { actor: null });
  await notify(me, "invitation", "You have been invited to the board Website", 6, { cardId: null });
  for (let i = 0; i < 50; i++) {
    await notify(me, "card_moved", `Card "Card ${i}" moved from "Todo" to "Doing"`, 10 + i, { isRead: 1 });
  }
  // Somebody else's are not mine.
  await notify(anna, "comment", 'New comment by "Florian" on card "Fix the contact form": <p>Not for me</p>', 0.5, { actor: me });

  const total = 56;
  const pageSize = 25;

  // The rows on the page itself, not the ones in the bell's panel or header.
  const onPage = (p) => p.evaluate(() => [...document.querySelectorAll("a[href^='/board/']")]
    .filter((a) => !a.closest("header") && !a.closest("body > div.fixed"))
    .map((a) => ({
      text: a.innerText.replace(/\s+/g, " ").trim(),
      cls: a.className,
      href: a.getAttribute("href"),
      unread: !!a.querySelector("[aria-label='Unread']"),
    })));

  // ------------------------------------------------------------ browser ----
  const engines = [["Chromium", chromium], ["WebKit", webkit]];
  for (const [engineName, engine] of engines) {
    try {
      browser = await engine.launch();
    } catch {
      console.log(`\n(${engineName} is not installed here — skipped)`);
      continue;
    }
    console.log(`\nin ${engineName}`);
    // Every engine starts from the same state: the first one opened a card,
    // which marks its notifications read.
    await c.execute("UPDATE notifications SET isRead = (message LIKE '%moved from%') WHERE userId = ?", [me.id]);

    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addCookies([{ name: "session_token", value: me.cookie.split("=").slice(1).join("="), domain: "127.0.0.1", path: "/" }]);
    page = await context.newPage();
    const errors = [];
    page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto(`${BASE}/dashboard/`, { waitUntil: "networkidle" });
    const order = await page.evaluate(() => {
      const row = document.querySelector("[data-onboarding='new-board']").parentElement;
      return [...row.children].map((el) => {
        if (el.querySelector("[aria-haspopup='menu']")) return "menu";
        if (el.matches("[data-onboarding='new-board']")) return "new";
        return el.tagName;
      });
    });
    check("the dashboard's buttons are the menu and the new board, nothing more", JSON.stringify(order) === JSON.stringify(["menu", "new"]), JSON.stringify(order));

    const bellLink = page.locator("header a[aria-label='Notifications']");
    check("the bell is a link to Activity", (await bellLink.getAttribute("href")) === "/dashboard/?view=feed", await bellLink.getAttribute("href"));
    const panel = page.locator("body > div.fixed");

    // Held for a new tab, it is followed there, and the panel stays shut here.
    const [opened] = await Promise.all([
      context.waitForEvent("page"),
      bellLink.click({ modifiers: ["ControlOrMeta"] }),
    ]);
    await opened.waitForLoadState("networkidle");
    check("held for a new tab, it opens Activity there", new URL(opened.url()).searchParams.get("view") === "feed" && (await opened.locator("h1").textContent()).trim() === "Activity", opened.url());
    await opened.close();
    await page.waitForTimeout(300);
    check("and leaves this page as it was", new URL(page.url()).pathname === "/dashboard/" && !(await panel.isVisible().catch(() => false)));

    // A plain click opens the panel, as it always has.
    await bellLink.click();
    await page.waitForSelector("body > div.fixed a[href^='/board/']");
    check("a plain click opens the panel instead", !new URL(page.url()).searchParams.get("view") && (await bellLink.getAttribute("aria-expanded")) === "true");
    const bell = await page.evaluate(() => [...document.querySelectorAll("body > div.fixed a[href^='/board/']")].map((a) => ({
      text: a.innerText.replace(/\s+/g, " ").trim(), cls: a.className, href: a.getAttribute("href"),
    })));
    const showAll = panel.getByRole("link", { name: "Show all" });
    check("which offers all of them on a page", await showAll.isVisible());
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `panel-${engineName}.png`) });

    await showAll.click();
    await page.waitForURL((url) => url.searchParams.get("view") === "feed", { timeout: 10000 });
    await page.waitForFunction(() => [...document.querySelectorAll("a[href^='/board/']")].some((a) => !a.closest("header") && !a.closest("body > div.fixed")), null, { timeout: 10000 });
    check("and goes there, closing the panel", !(await panel.isVisible().catch(() => false)));
    check("which names itself", (await page.locator("h1").textContent()).trim() === "Activity");

    const first = await onPage(page);
    check("a page of the bell's size", first.length === pageSize, String(first.length));
    check("the same notifications as the bell, in the same order",
      bell.length === first.length && bell.every((row, i) => row.text === first[i].text && row.href === first[i].href),
      `${bell.length} in the bell`);
    check("drawn the same way", bell.every((row, i) => first[i].cls.includes(row.cls)), first[0]?.cls);

    const texts = first.map((row) => row.text);
    check("a comment says who and on what, with what was said",
      texts[0].includes('Anna commented on "Fix the contact form"') && texts[0].includes("Looks good to me"), texts[0]);
    check("a move says from where to where", texts[1].includes('Anna moved "Fix the contact form" from "Todo" to "Doing"'), texts[1]);
    check("a card done, a card put on me, a reminder and an invitation read as in the bell",
      texts[2].includes('marked "Fix the contact form" done') && texts[3].includes('assigned "Fix the contact form" to you') &&
      texts[4].includes('LokalBoards reminds you: "Fix the contact form" is due on') && texts[5].includes('invited you to the board "Website"'),
      JSON.stringify(texts.slice(2, 6)));
    check("nobody else's notification is in it", !texts.some((t) => t.includes("Not for me")));
    check("what is unread has its dot, what is read does not",
      JSON.stringify(first.slice(0, 3).map((row) => row.unread)) === JSON.stringify([true, false, true]));
    check("the comment sits in its bubble", await page.locator(".wysiwyg-wrapper strong", { hasText: "good" }).first().isVisible());
    check("an invitation leads to the board, a card's notification to the card",
      first[5].href === `/board/${website}` && first[0].href === `/board/${website}?card=${form}`);

    // Further back, a page at a time.
    const older = page.getByRole("button", { name: "Show older" });
    const more = async (beyond) => {
      await older.click();
      await page.waitForFunction((n) => [...document.querySelectorAll("a[href^='/board/']")]
        .filter((a) => !a.closest("header") && !a.closest("body > div.fixed")).length > n, beyond, { timeout: 10000 });
    };
    check("and a way further back", await older.isVisible());
    await more(pageSize);
    check("which adds the next page under it", (await onPage(page)).length === 2 * pageSize, String((await onPage(page)).length));
    await more(2 * pageSize);
    const all = await onPage(page);
    check("until it is all there, and the button gone", all.length === total && !(await older.isVisible().catch(() => false)), `${all.length} of ${total}`);
    check("no notification twice", new Set(all.map((row) => row.text)).size === all.length);
    if (SHOTS) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(SHOTS, `feed-${engineName}.png`) });
    }

    // Into a card, and back.
    await page.locator(`a[href='/board/${website}?card=${form}']`).filter({ hasText: "commented" }).last().click();
    await page.waitForURL((url) => url.pathname.startsWith(`/board/${website}`) && url.searchParams.get("card") === String(form), { timeout: 10000 });
    check("a notification opens its card", true);
    await page.waitForTimeout(800);
    await page.goBack();
    await page.waitForURL((url) => url.pathname === "/dashboard/" && url.searchParams.get("view") === "feed", { timeout: 10000 });
    await page.waitForFunction(() => [...document.querySelectorAll("a[href^='/board/']")].some((a) => !a.closest("header") && !a.closest("body > div.fixed")), null, { timeout: 10000 });
    check("and Back returns to Activity", true);
    const afterOpen = (await onPage(page)).filter((row) => row.href.includes(`card=${form}`) && row.unread).length;
    check("where the card's notifications are read now, as they are in the bell", afterOpen === 0, `${afterOpen} still unread`);

    await page.locator("header a").first().click();
    await page.waitForURL((url) => /^\/dashboard\/?$/.test(url.pathname) && !url.searchParams.get("view"), { timeout: 10000 });
    await page.waitForTimeout(500);
    check("the logo leads back to the boards", (await page.locator("h1").textContent()).trim() === "Boards");

    // A phone: the heading and three round buttons in one row.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${BASE}/dashboard/?view=feed`, { waitUntil: "networkidle" });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check("on a phone nothing runs off the side", overflow <= 0, `${overflow}px`);
    const switchShown = await page.evaluate(() => [...document.querySelectorAll("input[name='dashboardView']")].some((input) => input.closest("div")?.offsetParent !== null));
    check("and the Boards / My work switch is not under the heading", !switchShown);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `feed-mobile-${engineName}.png`) });

    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload({ waitUntil: "networkidle" });
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `feed-dark-${engineName}.png`) });

    check("and nothing to say in the console", errors.length === 0, errors.join(" | "));
    await context.close();

    // Somebody with no notifications at all is told so.
    const quietContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await quietContext.addCookies([{ name: "session_token", value: quiet.cookie.split("=").slice(1).join("="), domain: "127.0.0.1", path: "/" }]);
    const quietPage = await quietContext.newPage();
    await quietPage.goto(`${BASE}/dashboard/?view=feed`, { waitUntil: "networkidle" });
    check("with nothing to show it says so", await quietPage.locator("p", { hasText: "No notifications yet" }).first().isVisible());
    await quietContext.close();

    await browser.close();
    browser = null;
  }
} catch (error) {
  console.error(`\n FAIL  the run stopped early — ${error.message.split("\n")[0]}`);
  if (SHOTS && page) await page.screenshot({ path: path.join(SHOTS, "failure.png") }).catch(() => {});
  failures++;
} finally {
  await stop();
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures ? 1 : 0);
