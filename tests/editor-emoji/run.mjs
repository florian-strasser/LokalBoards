// The caret behind an emoji, and spaces as they are typed.
//
// Both are the same omission. ProseMirror relies on a few rules of its own
// being in the stylesheet, TipTap normally injects them, and the editor here is
// told not to — so they have to be in main.css, and for a long time were not.
//
// Behind an emoji at the end of a line the editor puts an invisible image, to
// give the caret somewhere to stand. Tailwind's reset makes every image a
// block, so the image took a line of its own: the caret dropped onto an empty
// row under the text, the box grew by that row, and it all snapped back with
// the next character typed. And without `white-space: pre-wrap` a browser
// cannot show two spaces in a row, so it writes a non-breaking one instead —
// which was then saved into the comment.
//
// A third thing is Safari's own. WebKit paints a selection that covers only
// something the caret cannot enter — an emoji — from the start of the line, as
// if the text before it were selected too; what is copied is still only the
// emoji. It does not do that when the editable box is a flex item, so the box
// the editor is mounted in is a flex column (`.editor-box` in main.css). No DOM
// question can see a painted highlight, so this one is measured in a
// screenshot: where the blue starts and ends, against where the emoji is.
//
// It also checks the picker — a popover that holds every emoji and does not
// move the text when it opens, searched by name — and `:` typed into the text,
// which lists the emoji a name matches under the caret; Escape there closes the
// list and leaves the card open.
//
// This types into the comment editor of a card and checks the box does not
// grow when an emoji is the last thing on a line, that Backspace there takes
// the emoji away again, that two spaces typed in a row are two ordinary spaces
// and none of them is saved as a non-breaking one, and that the editor has
// nothing to say in the console. In
// Chromium and, where it is installed, in WebKit — Safari is where this was
// reported, and both engines get the invisible image.
//
// Requires a built app (`npm run build`) and the credentials in `.env.local`.
// Creates and drops a database of its own.
import fs from "node:fs";
import { spawn } from "node:child_process";
import mysql from "mysql2/promise";
import { chromium, webkit } from "playwright";
import sharp from "sharp";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const DB = "lokalboards_editor_emoji";
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

try {
  const check = (name, ok, detail = "") => {
    console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? " — " + detail : ""}`);
    if (!ok) failures++;
  };

  await fetch(`${BASE}/api/auth/sign-up`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Florian", email: "owner@example.test", password: "correct horse battery" }) });
  const signIn = await fetch(`${BASE}/api/auth/sign-in`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "owner@example.test", password: "correct horse battery" }) });
  const cookie = (signIn.headers.getSetCookie?.() ?? []).map((x) => x.split(";")[0])
    .find((x) => x.startsWith("session_token="));
  const [[me]] = await c.query("SELECT id FROM `user` WHERE email = 'owner@example.test'");
  await c.query("UPDATE `user` SET onboarded = 1 WHERE id = ?", [me.id]);
  const [board] = await c.execute("INSERT INTO boards (user, name, status) VALUES (?,?,?)", [me.id, "Yes", "private"]);
  const [area] = await c.execute("INSERT INTO areas (board, name, sort) VALUES (?,?,?)", [board.insertId, "Todo", 0]);

  for (const [name, engine] of [["Chromium", chromium], ["WebKit", webkit]]) {
    console.log(`\nin ${name}`);
    try {
      browser = await engine.launch();
    } catch (error) {
      // Not every machine that runs this has every engine installed.
      console.log(`  --   not installed here, skipped (${error.message.split("\n")[0].slice(0, 60)})`);
      continue;
    }
    // A card of its own for each engine, so one's comment is not the other's.
    const [card] = await c.execute(
      "INSERT INTO cards (area, name, content, status, sort) VALUES (?, ?, '', 0, 0)", [area.insertId, `Card for ${name}`]);
    const context = await browser.newContext({ viewport: { width: 1300, height: 900 } });
    await context.addCookies([{ name: "session_token", value: cookie.split("=").slice(1).join("="), domain: "127.0.0.1", path: "/" }]);
    const page = await context.newPage();
    const complaints = [];
    page.on("console", (message) => { if (/ProseMirror/.test(message.text())) complaints.push(message.text()); });
    await page.goto(`${BASE}/board/${board.insertId}?card=${card.insertId}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: "Write a comment" }).click();
    await page.waitForTimeout(700);
    const editor = page.locator(".card-modal .tiptap").last();
    // The picker is a popover in <body>, not part of the dialog; the emoji
    // asked for here are all in its first row.
    const openPicker = async () => {
      await page.locator(".card-modal button:has(svg.lucide-smile)").last().click();
      await page.waitForTimeout(400);
    };
    const pick = async (emoji) => {
      await openPicker();
      await page.locator("button.emoji-cell[data-name]", { hasText: emoji }).first().click();
      await page.waitForTimeout(400);
    };
    const look = () => editor.evaluate((el) => {
      const emoji = el.querySelector('[data-type="emoji"]');
      const separator = el.querySelector("img.ProseMirror-separator");
      const lineBreak = el.querySelector("br.ProseMirror-trailingBreak");
      return {
        height: Math.round(el.getBoundingClientRect().height),
        emojis: el.querySelectorAll('[data-type="emoji"]').length,
        text: el.textContent,
        separator: separator ? getComputedStyle(separator).display : "none needed",
        // How far below the emoji the caret's line starts. 0 is the same line.
        drop: emoji && lineBreak
          ? Math.round(lineBreak.getBoundingClientRect().top - emoji.getBoundingClientRect().top) : 0,
      };
    });

    // What is painted as selected on the emoji's line: where the highlight
    // starts and ends, measured from the paragraph's left edge, beside where
    // the emoji is. The highlight is the one thing on that line that is bluer
    // than it is red.
    const painted = async () => {
      const box = await editor.evaluate((el) => {
        const emoji = el.querySelector('[data-type="emoji"]');
        const p = emoji.closest("p").getBoundingClientRect(), e = emoji.getBoundingClientRect();
        return { x: p.x, y: p.y, width: Math.min(p.width, 600), height: p.height,
                 emojiLeft: Math.round(e.left - p.left), emojiRight: Math.round(e.right - p.left),
                 selected: getSelection().toString() };
      });
      const shot = await page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
      const { data, info } = await sharp(shot).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const scale = info.width / box.width;
      let first = -1, last = -1;
      for (let x = 0; x < info.width; x++) {
        let blue = 0;
        for (let y = 0; y < info.height; y++) {
          const i = (y * info.width + x) * 4;
          if (data[i + 2] - data[i] > 28 && data[i + 2] > 90) blue++;
        }
        if (blue >= 3 * scale) { if (first < 0) first = x; last = x; }
      }
      return { ...box, from: first < 0 ? null : Math.round(first / scale), to: last < 0 ? null : Math.round((last + 1) / scale) };
    };
    const near = (a, b) => a !== null && Math.abs(a - b) <= 3;

    await editor.click();
    await page.keyboard.type("Das ist nice ");
    const plain = await look();
    await pick("👍");
    const last = await look();
    check("an emoji is put in", last.emojis === 1, last.text);
    check("the box does not grow a row for it", last.height === plain.height, `${plain.height}px → ${last.height}px`);
    check("the caret stays on the emoji's line", last.drop === 0, `${last.drop}px below`);
    check("the image the editor hides behind it is not a block", last.separator !== "block", last.separator);

    await page.keyboard.type(" 12");
    const typed = await look();
    check("typing on carries on in the same line, at the same height",
      typed.height === plain.height && typed.text.endsWith(" 12"), JSON.stringify(typed.text));
    for (let i = 0; i < 3; i++) await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    const gone = await look();
    check("Backspace behind the emoji takes it away again",
      gone.emojis === 0 && gone.text === "Das ist nice ", JSON.stringify(gone.text));

    // --- Spaces --------------------------------------------------------------
    await page.keyboard.type("und  zwei Leerzeichen ");
    const held = await editor.evaluate((el) => el.textContent);
    check("two spaces in a row are two spaces, not a non-breaking one",
      !held.includes("\u00a0") && held.includes("und  zwei"), JSON.stringify(held));
    await page.keyboard.type("am Ende");
    await pick("🚀");
    await page.getByRole("button", { name: "Create comment" }).click();
    await page.waitForTimeout(1200);
    const [[stored]] = await c.query("SELECT content FROM comments WHERE card = ? ORDER BY id DESC LIMIT 1", [card.insertId]);
    check("the comment is saved", !!stored, String(stored?.content));
    // Saving turns the text into Markdown, which folds a run of spaces into
    // one — what must not survive is a non-breaking space standing in for one.
    check("with ordinary spaces in it, and no non-breaking one",
      !!stored && !stored.content.includes("\u00a0") && !/&nbsp;|&#160;/.test(stored.content) &&
      /und +zwei Leerzeichen am Ende/.test(stored.content), JSON.stringify(stored?.content));
    check("and its emoji", !!stored && /rocket|🚀/.test(stored.content), JSON.stringify(stored?.content));

    // --- What a selection of the emoji looks like -----------------------------
    // In an editor of its own, so nothing of the comment above is in the way.
    await page.getByRole("button", { name: "Write a comment" }).click();
    await page.waitForTimeout(700);
    await editor.click();
    await page.keyboard.type("Das ist nice ");
    await pick("😄");
    await page.keyboard.press("Shift+ArrowLeft");
    await page.waitForTimeout(300);
    const alone = await painted();
    check("selecting only the emoji selects only the emoji", alone.selected === "😄", JSON.stringify(alone.selected));
    check("and only the emoji is painted as selected, not the line before it",
      near(alone.from, alone.emojiLeft) && near(alone.to, alone.emojiRight),
      `painted ${alone.from}–${alone.to}px, the emoji is ${alone.emojiLeft}–${alone.emojiRight}px`);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.type(" ok");
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Shift+ArrowLeft");
    await page.waitForTimeout(300);
    const middle = await painted();
    check("the same with text after it",
      middle.selected === "😄" && near(middle.from, middle.emojiLeft) && near(middle.to, middle.emojiRight),
      `painted ${middle.from}–${middle.to}px, the emoji is ${middle.emojiLeft}–${middle.emojiRight}px`);
    for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowLeft");
    await page.waitForTimeout(300);
    const both = await painted();
    check("text and emoji selected together are painted together",
      both.selected.endsWith("😄") && both.selected.length > 3 &&
      both.from !== null && both.from < both.emojiLeft - 10 && near(both.to, both.emojiRight),
      `${JSON.stringify(both.selected)} painted ${both.from}–${both.to}px, the emoji is ${both.emojiLeft}–${both.emojiRight}px`);

    // --- The picker, and `:` typed into the text ------------------------------
    // The old picker took the toolbar's place, and a longer list of emoji
    // would have pushed the text down; this one floats, so it can hold them all.
    // In the editor the selection checks above left open, emptied.
    await editor.click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("Heute ");
    const before = await editor.boundingBox();
    await openPicker();
    const offered = await page.locator("button.emoji-cell[data-name]").count();
    const after = await editor.boundingBox();
    check("the picker offers far more than eight emoji", offered > 1000, `${offered}`);
    check("and opening it does not move the text", Math.abs(before.y - after.y) < 1 && Math.abs(before.height - after.height) < 1,
      `${Math.round(before.y)}px → ${Math.round(after.y)}px`);
    const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    check("its search field has the focus", focused === "Search emoji", String(focused));
    await page.keyboard.type("fire");
    await page.waitForTimeout(300);
    const firstFound = await page.locator("button.emoji-cell[data-name]").first().textContent();
    check("searching finds the emoji by name, best first", firstFound?.trim() === "🔥", JSON.stringify(firstFound));
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    const picked = await look();
    check("Enter puts the first one in, where the caret was",
      picked.emojis === 1 && picked.text.startsWith("Heute 🔥"), JSON.stringify(picked.text));
    check("and closes the picker", await page.locator("button.emoji-cell").count() === 0);

    const listbox = page.locator('[role="listbox"]');
    // ":roc" would be 🪨 :rock: first, which is fair; one letter more is the rocket.
    await page.keyboard.type(" :rocke");
    await page.waitForTimeout(400);
    const suggested = await listbox.locator('[role="option"]').first().textContent().catch(() => null);
    check("typing : and a name opens a list under the caret", (await listbox.count()) === 1 && /🚀/.test(suggested ?? ""),
      JSON.stringify(suggested));
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
    const typedIn = await look();
    check("Enter there puts the emoji in place of what was typed",
      typedIn.emojis === 2 && typedIn.text.includes("🚀") && !typedIn.text.includes(":rocke"), JSON.stringify(typedIn.text));
    check("and the list is gone", (await listbox.count()) === 0);

    await page.keyboard.type(":fi");
    await page.waitForTimeout(400);
    const openAgain = await listbox.count();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    check("Escape closes the list", openAgain === 1 && (await listbox.count()) === 0, `${openAgain} list(s) before`);
    check("and only the list — the card stays open", await page.locator(".card-modal").first().isVisible());
    check("leaving what was typed as it was", (await look()).text.endsWith(":fi"), JSON.stringify((await look()).text));

    await page.keyboard.type(" :D ");
    await page.waitForTimeout(300);
    check("a smiley typed as :D still turns into one", (await look()).emojis === 3, JSON.stringify((await look()).text));

    check("the editor has nothing to complain of in the console", complaints.length === 0, complaints[0]?.slice(0, 80) ?? "");

    // --- On a touch screen -------------------------------------------------
    // The keyboard has an emoji key there, so the toolbar has no button for
    // it; `:` and a name still work.
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await phone.addCookies([{ name: "session_token", value: cookie.split("=").slice(1).join("="), domain: "127.0.0.1", path: "/" }]);
    const touch = await phone.newPage();
    await touch.goto(`${BASE}/board/${board.insertId}?card=${card.insertId}`, { waitUntil: "domcontentloaded" });
    await touch.waitForTimeout(2500);
    const coarse = await touch.evaluate(() => matchMedia("(hover: none) and (pointer: coarse)").matches);
    await touch.getByRole("button", { name: "Write a comment" }).click();
    await touch.waitForTimeout(700);
    const touchToolbar = touch.locator(".card-modal .editor-toolbar").last();
    check("a touch screen is taken for one", coarse);
    check("and its toolbar has no emoji button",
      (await touchToolbar.locator("button:has(svg.lucide-smile)").isVisible()) === false &&
      (await touchToolbar.locator("button:has(svg.lucide-bold)").isVisible()) === true);
    await touch.locator(".card-modal .tiptap").last().tap();
    await touch.keyboard.type("Hallo :rocke");
    await touch.waitForTimeout(400);
    const touchList = await touch.locator('[role="listbox"] [role="option"]').first().textContent().catch(() => null);
    check("but : and a name still list the emoji", /🚀/.test(touchList ?? ""), JSON.stringify(touchList));
    await phone.close();

    // And with a mouse, the button is there.
    check("with a mouse the button is there",
      await page.locator(".card-modal .editor-toolbar").last().locator("button:has(svg.lucide-smile)").isVisible());
    await browser.close();
    browser = null;
  }
} catch (error) {
  console.error(`\n FAIL  the run stopped early — ${error.message.split("\n")[0]}`);
  failures++;
} finally {
  await stop();
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures ? 1 : 0);
