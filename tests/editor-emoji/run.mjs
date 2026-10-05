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
    const pick = async (emoji) => {
      await page.locator(".card-modal button:has(svg.lucide-smile)").last().click();
      await page.waitForTimeout(300);
      await page.locator(".card-modal li button.block", { hasText: emoji }).click();
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

    check("the editor has nothing to complain of in the console", complaints.length === 0, complaints[0]?.slice(0, 80) ?? "");
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
