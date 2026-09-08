// What a label is, and how long it lives.
//
// A label is not a board's vocabulary you switch on and off per card: it is a
// word typed on a card. The row in `labels` exists so the same word on two
// cards is one thing — which is what a tile draws, what a filter would group
// by, and what fills the names offered when adding one. Everything that follows
// from that is what this checks:
//
//   * typing a word that is already in use joins the existing label rather than
//     making a second one with the same name,
//   * the menu only ever adds one — rewording and removing are on the label
//     itself, on the card, where the thing being pointed at is,
//   * rewording on one card points that card at another word and leaves every
//     other card alone,
//   * a word nothing wears any more is swept, while one another card still
//     wears survives,
//   * a label is one of the words a card can be found by,
//   * labelling a card is written into the card's own history,
//   * a label added by one person reaches everybody else's board over the
//     socket, without a reload,
//   * only somebody who may write on the board may add one,
//   * and the menu neither overflows the card nor gives it a scrollbar, which
//     is what the colour grid it replaced used to do.
//
// Requires a built app (`npm run build`) and the credentials in `.env.local`.
// Creates and drops a database of its own; it never touches an existing one.
import fs from "node:fs";
import { spawn } from "node:child_process";
import mysql from "mysql2/promise";
import { chromium, webkit } from "playwright";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const DB = "lokalboards_labels";
const PORT = 3100, BASE = `http://127.0.0.1:${PORT}`;
const creds = { host: env.NUXT_MYSQL_HOST, user: env.NUXT_MYSQL_USER, password: env.NUXT_MYSQL_PASSWORD };

const admin = await mysql.createConnection(creds);
await admin.query(`DROP DATABASE IF EXISTS \`${DB}\``);
await admin.query(`CREATE DATABASE \`${DB}\``);
await admin.end();

const child = spawn("node", [".output/server/index.mjs"], {
  env: { ...process.env, ...env, NUXT_MYSQL_DATABASE: DB, NUXT_MYSQL_SSL: "false", NUXT_PUBLIC_SIGNUP: "true",
         PORT: String(PORT), NITRO_PORT: String(PORT), NUXT_BOARDS_URL: BASE, NUXT_LOG_LEVEL: "error" },
  stdio: ["ignore", "pipe", "pipe"],
});
for (let i = 0; i < 120; i++) {
  try { if ((await fetch(BASE + "/")).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
const c = await mysql.createConnection({ ...creds, database: DB });
for (let i = 0; i < 200; i++) {
  const [r] = await c.query("SELECT 1 FROM `migrations` WHERE `id` LIKE '0026%'").catch(() => [[]]);
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
  const viewer = await signUp("Viewer", "viewer@example.test");
  const editor = await signUp("Editor", "editor@example.test");
  const [[me]] = await c.query("SELECT id FROM `user` WHERE email = 'owner@example.test'");

  const [board] = await c.execute("INSERT INTO `boards` (user, name, status) VALUES (?,?,?)", [me.id, "Labels", "private"]);
  const boardId = board.insertId;
  const [area] = await c.execute("INSERT INTO `areas` (board, name, sort) VALUES (?,?,?)", [boardId, "Todo", 0]);
  const [one] = await c.execute("INSERT INTO `cards` (area, name, content, sort) VALUES (?,?,?,?)", [area.insertId, "First card", "", 0]);
  const [two] = await c.execute("INSERT INTO `cards` (area, name, content, sort) VALUES (?,?,?,?)", [area.insertId, "Second card", "", 1]);

  const labelRows = () => c.query("SELECT id, name, color FROM `labels` WHERE board = ? ORDER BY id", [boardId]).then(([r]) => r);
  const wornBy = (card) => c.query(
    "SELECT l.name FROM card_labels cl JOIN labels l ON l.id = cl.label WHERE cl.card = ? ORDER BY l.name", [card],
  ).then(([r]) => r.map((x) => x.name).join(","));

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.context().addCookies([{ name: "session_token", value: owner.split("=").slice(1).join("="),
    domain: "127.0.0.1", path: "/" }]);

  const dialog = () => page.locator("div.overflow-y-auto.overflow-x-hidden").first();
  const chip = () => page.locator("button", { hasText: /^\s*Labels\s*$/ }).first();
  const panel = () => page.locator("body > div.fixed.z-50.rounded-xl").first();
  const cardLabels = () => page.locator(".label-pill-editable");

  const openCard = async (name) => {
    await page.goto(`${BASE}/board/${boardId}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(900);
    await page.locator(`text=${name}`).first().click();
    await page.waitForTimeout(900);
  };
  const openMenu = async (name) => { await openCard(name); await chip().click(); await page.waitForTimeout(400); };
  // The field a label's word becomes while it is being reworded — inside the
  // pill, wearing none of its own chrome.
  const cardLabelInput = () => page.locator("input.label-pill-input").first();

  // ---------------------------------------------------------------- the menu --
  await openCard("First card");
  const shut = await dialog().evaluate((el) => [el.scrollHeight, el.clientHeight]);
  await chip().click();
  await page.waitForTimeout(400);
  const open = await dialog().evaluate((el) => [el.scrollHeight, el.clientHeight]);
  check("the card does not gain a scrollbar when the menu opens",
    shut[0] === shut[1] && open[0] === open[1], `${shut.join("/")} then ${open.join("/")}`);
  check("the menu is drawn outside the card", await panel().evaluate((el) => el.parentElement.tagName) === "BODY");
  const box = await panel().boundingBox(), view = page.viewportSize();
  check("and stays inside the window",
    box.x >= 0 && box.y >= 0 && box.x + box.width <= view.width && box.y + box.height <= view.height,
    `x ${Math.round(box.x)} y ${Math.round(box.y)} w ${Math.round(box.width)} h ${Math.round(box.height)}`);

  // ------------------------------------------------------------------ adding --
  await panel().locator("input[type=text]").fill("Bug");
  await panel().locator("input[type=submit]").click();
  await page.waitForTimeout(900);
  check("the label is on the card", await wornBy(one.insertId) === "Bug");
  check("one row exists for it", (await labelRows()).length === 1);
  check("it is drawn on the card and on the tile behind it",
    await page.locator('.label-pill:has-text("Bug")').count() >= 2);
  check("on its own line, not inside the button that adds one",
    await chip().locator(".label-pill").count() === 0);
  check("adding closes the menu, so the line it joined is visible",
    await panel().count() === 0);

  // The label sits under the buttons and above everything the card says.
  const place = await page.evaluate(() => {
    const chip = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Labels");
    const wrap = chip.closest("div.mb-4");
    const top = (el) => Math.round(el.getBoundingClientRect().top);
    return {
      buttons: top(wrap.querySelector("div.flex.flex-wrap.items-center.gap-2")),
      labels: top(wrap.querySelector(".label-pill-editable")),
      content: top(wrap.nextElementSibling),
    };
  });
  check("under the buttons and above the card's content",
    place.buttons < place.labels && place.labels < place.content, JSON.stringify(place));

  // ------------------------------------------------------------ reuse by name --
  await page.keyboard.press("Escape");
  await openMenu("Second card");
  const offered = (await panel().locator(".label-pill").allInnerTexts()).map((s) => s.trim());
  check("a word the board already uses is offered", offered.includes("Bug"), JSON.stringify(offered));
  check("and the menu offers nothing else — no rewording, no removing",
    await panel().locator(".label-pill-remove, .label-pill-name").count() === 0);
  await panel().locator(".label-pill", { hasText: "Bug" }).click();
  await page.waitForTimeout(900);
  check("the second card wears it too", await wornBy(two.insertId) === "Bug");
  check("and both cards share the one row", (await labelRows()).length === 1);

  // ------------------------------------------------------------- rewording ---
  await openCard("First card");
  // Rewording must not redress the label: the pill keeps its colour, its
  // padding and its height, and only its word becomes typeable.
  const pill = page.locator(".label-pill-editable").first();
  const look = (el) => {
    const s = getComputedStyle(el);
    return [s.backgroundColor, s.padding, s.borderRadius, s.fontSize].join(" | ");
  };
  const restBox = await pill.boundingBox();
  const restLook = await pill.evaluate(look);
  await page.locator(".label-pill-name").first().click();
  // A click leaves the pointer on the pill, and hovering is a change of its
  // own; take the pointer away so what is measured is the editing state.
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  const editBox = await pill.boundingBox();
  const editLook = await pill.evaluate(look);
  check("the pill looks the same while its word is being edited",
    restLook === editLook && Math.abs(restBox.height - editBox.height) < 1,
    `${restLook} / ${editLook}, ${restBox.height}px then ${editBox.height}px`);
  check("and does not change width at all",
    Math.abs(restBox.width - editBox.width) < 1,
    `${restBox.width.toFixed(1)}px then ${editBox.width.toFixed(1)}px`);
  const field = await page.evaluate(() => {
    const el = document.activeElement;
    const s = getComputedStyle(el);
    return { tag: el.tagName, cls: String(el.className), border: s.borderStyle,
             background: s.backgroundColor, padding: s.padding };
  });
  check("the field itself wears no chrome",
    field.cls.includes("label-pill-input") && field.border === "none" &&
      field.background === "rgba(0, 0, 0, 0)" && field.padding === "0px",
    JSON.stringify(field));
  await cardLabelInput().fill("Blocked");
  await cardLabelInput().press("Enter");
  await page.waitForTimeout(1000);
  check("this card wears the new word", await wornBy(one.insertId) === "Blocked");
  check("the other card is untouched", await wornBy(two.insertId) === "Bug");
  check("so both words now exist", (await labelRows()).length === 2,
    JSON.stringify((await labelRows()).map((r) => r.name)));

  // ------------------------------------------------------- removing, sweeping --
  await page.locator(".label-pill-remove").first().click();
  await page.waitForTimeout(1000);
  check("the cross takes the label off the card", await wornBy(one.insertId) === "");
  const left = (await labelRows()).map((r) => r.name);
  check("the word nothing wears any more is swept", !left.includes("Blocked"), JSON.stringify(left));
  check("the word another card wears survives", left.includes("Bug"), JSON.stringify(left));

  // ----------------------------------------------------------- rewording edges --
  await openCard("Second card");
  await page.locator(".label-pill-name").first().click();
  await page.waitForTimeout(250);
  await cardLabelInput().fill("Escaped");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
  check("Escape abandons a rewording", await wornBy(two.insertId) === "Bug", await wornBy(two.insertId));
  check("and puts the label back", await cardLabels().count() === 1);

  await page.locator(".label-pill-name").first().click();
  await page.waitForTimeout(250);
  await cardLabelInput().fill("Committed");
  await page.mouse.click(200, 800); // away from the field and the card alike
  await page.waitForTimeout(1200);
  check("clicking away commits one", await wornBy(two.insertId) === "Committed", await wornBy(two.insertId));

  await openMenu("Second card");
  const blank = panel().locator("input[type=text]");
  await blank.fill("   ");
  check("a blank name cannot be submitted", await panel().locator("input[type=submit]").isDisabled());
  await blank.fill("Committed");
  await panel().locator("input[type=submit]").click();
  await page.waitForTimeout(900);
  check("the same word twice stays one label", await wornBy(two.insertId) === "Committed", await wornBy(two.insertId));
  check("and one label on the card", await cardLabels().count() === 1);

  // -------------------------------------------------------------- who may write --
  await c.execute("UPDATE `boards` SET status = 'public' WHERE id = ?", [boardId]);
  const asViewer = (path, init = {}) => fetch(`${BASE}${path}`, { ...init, headers: { ...(init.headers || {}), cookie: viewer } });
  check("a reader may read the words in use", (await asViewer(`/api/data/labels?boardId=${boardId}`)).status === 200);
  const refused = await asViewer("/api/data/labels", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ boardId, name: "Sneaky" }) });
  check("a reader may not add one", refused.status === 403, `status ${refused.status}`);
  check("and none was added", !(await labelRows()).some((r) => r.name === "Sneaky"));

  // The width bug this guards against was engine-specific — a field sized by
  // its `size` attribute comes out wider in WebKit than in Blink — so the
  // measurement is repeated in the engine Safari uses, when it is installed.
  let safari = null;
  try {
    safari = await webkit.launch();
  } catch {
    console.log("  --   WebKit is not installed; its width check was skipped");
  }
  if (safari) {
    const other = await safari.newPage({ viewport: { width: 1280, height: 900 } });
    await other.context().addCookies([{ name: "session_token",
      value: owner.split("=").slice(1).join("="), domain: "127.0.0.1", path: "/" }]);
    await other.goto(`${BASE}/board/${boardId}`, { waitUntil: "networkidle" });
    await other.waitForTimeout(1200);
    await other.locator("text=Second card").first().click();
    await other.waitForTimeout(1000);
    const theirs = other.locator(".label-pill-editable").first();
    const before = (await theirs.boundingBox()).width;
    await other.locator(".label-pill-name").first().click();
    await other.mouse.move(0, 0);
    await other.waitForTimeout(400);
    const during = (await theirs.boundingBox()).width;
    check("nor in WebKit, where the old sizing was worst",
      Math.abs(before - during) < 1, `${before.toFixed(1)}px then ${during.toFixed(1)}px`);
    await safari.close();
  }

  // ---------------------------------------------------------------- finding --
  // A label is a word the card says about itself, so searching for it should
  // turn the card up — it was not in the query at all to begin with.
  const found = await fetch(`${BASE}/api/data/search?q=Committed`, { headers: { cookie: owner } })
    .then((r) => r.json());
  check("a card is found by its label",
    (found.cards || []).some((hit) => hit.name === "Second card"),
    JSON.stringify((found.cards || []).map((hit) => hit.name)));
  check("and the hit carries the label that found it",
    (found.cards || []).find((hit) => hit.name === "Second card")?.labels?.[0]?.name === "Committed");

  await page.goto(`${BASE}/dashboard/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.locator('input[type="search"]').first().fill("Committed");
  await page.waitForTimeout(1500);
  check("and the search results draw it",
    await page.locator('.label-pill:has-text("Committed")').count() > 0);

  // ------------------------------------------------------------- the history --
  await openCard("Second card");
  const history = page.locator("div.flex.items-start.gap-3.text-sm.text-gray");
  const newest = (await history.first().innerText()).replace(/\s+/g, " ").trim();
  check("labelling a card is written into its history", /Committed/.test(newest), newest.slice(0, 90));
  const [[recorded]] = await c.query(
    "SELECT COUNT(*) AS total FROM card_activity WHERE card = ? AND type = 'labels'", [two.insertId]);
  check("and recorded structured, not as prose", Number(recorded.total) >= 2, `${recorded.total} entries`);

  // ------------------------------------------------------ seen by everybody --
  const [[editorRow]] = await c.query("SELECT id FROM `user` WHERE email = 'editor@example.test'");
  await c.execute("INSERT INTO `invitations` (board, user, permission) VALUES (?,?,?)",
    [boardId, editorRow.id, "edit"]);
  const watcher = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await watcher.context().addCookies([{ name: "session_token", value: editor.split("=").slice(1).join("="),
    domain: "127.0.0.1", path: "/" }]);
  await watcher.goto(`${BASE}/board/${boardId}`, { waitUntil: "networkidle" });
  await watcher.waitForTimeout(1500);
  check("the other person's board has not heard of the word yet",
    await watcher.locator('.label-pill:has-text("Shared")').count() === 0);

  await openMenu("First card");
  await panel().locator("input[type=text]").fill("Shared");
  await panel().locator("input[type=submit]").click();
  await watcher.waitForTimeout(2500);
  check("a label added by somebody else arrives without a reload",
    await watcher.locator('.label-pill:has-text("Shared")').count() > 0);
  await watcher.close();

  // ----------------------------------------------------------------- one colour --
  check("every label is stored with the same colour",
    new Set((await labelRows()).map((r) => r.color)).size === 1);
} catch (error) {
  // A check that throws is a failure like any other — but the server and
  // the database it made should not outlive it.
  console.error(`\n FAIL  the run stopped early — ${error.message.split("\n")[0]}`);
  failures++;
} finally {
  await stop();
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures ? 1 : 0);
