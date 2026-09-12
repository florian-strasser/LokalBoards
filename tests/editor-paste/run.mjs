// Pasting a copied image inserts it once.
//
// "Copy image" in a browser puts two things on the clipboard: the picture
// itself, and a scrap of `text/html` holding an `<img>` that points back where
// it came from. The editor uploads the file; ProseMirror, given the chance,
// pastes the HTML on top of it — so the card ended up with two pictures, of
// which only the uploaded one survived a save. This reproduces that clipboard
// exactly and checks that one picture arrives, that it is ours, and that a
// paste carrying no file still behaves as it always did.
//
// Requires a built app (`npm run build`) and the credentials in `.env.local`.
// Creates and drops a database of its own; it never touches an existing one.
import fs from "node:fs";
import { spawn } from "node:child_process";
import mysql from "mysql2/promise";
import sharp from "sharp";
import { chromium } from "playwright";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const DB = "lokalboards_paste";
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

  await fetch(`${BASE}/api/auth/sign-up`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Owner", email: "owner@example.test", password: "correct horse battery" }) });
  const signIn = await fetch(`${BASE}/api/auth/sign-in`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "owner@example.test", password: "correct horse battery" }) });
  const cookie = (signIn.headers.getSetCookie?.() ?? []).map((x) => x.split(";")[0])
    .find((x) => x.startsWith("session_token="));

  const [[me]] = await c.query("SELECT id FROM `user` LIMIT 1");
  const [board] = await c.execute("INSERT INTO boards (user, name, status) VALUES (?,?,?)", [me.id, "Paste", "private"]);
  const boardId = board.insertId;
  const [area] = await c.execute("INSERT INTO areas (board, name, sort) VALUES (?,?,?)", [boardId, "Todo", 0]);
  const [card] = await c.execute("INSERT INTO cards (area, name, content, sort) VALUES (?,?,?,?)",
    [area.insertId, "Tickets", "", 0]);

  // A real picture: the upload endpoint runs it through sharp, and a handful of
  // made-up bytes would be refused before any of this was exercised.
  const png = (await sharp({
    create: { width: 48, height: 24, channels: 3, background: { r: 20, g: 80, b: 200 } },
  }).png().toBuffer()).toString("base64");

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.context().addCookies([{ name: "session_token", value: cookie.split("=").slice(1).join("="),
    domain: "127.0.0.1", path: "/" }]);

  const openEditor = async () => {
    await page.goto(`${BASE}/board/${boardId}?card=${card.insertId}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    const edit = page.locator("button", { hasText: /Beschreibung bearbeiten|Edit description/ }).first();
    if (await edit.count()) {
      await edit.click();
      await page.waitForTimeout(600);
    }
    await page.locator(".tiptap").first().click();
  };

  // The clipboard a browser builds for "copy image": the file, and an <img>
  // pointing back at the page it was copied from.
  const pasteCopiedImage = async () =>
    page.evaluate((base64) => {
      const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], "image002.png", { type: "image/png" }));
      transfer.setData(
        "text/html",
        '<img src="https://theatre.example/image002.png" alt="image002.png">',
      );
      document.querySelector(".tiptap").dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
    }, png);

  await openEditor();
  await pasteCopiedImage();
  await page.waitForTimeout(2500);

  const images = await page.locator(".tiptap img").count();
  check("one paste puts in one picture", images === 1, `${images} in the editor`);
  const sources = await page.locator(".tiptap img").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("src")));
  check("and it is the one we uploaded, not the one from the page it came from",
    sources.every((src) => src && !src.startsWith("http")), JSON.stringify(sources));

  await page.locator("button", { hasText: /Speichern|Save/ }).first().click();
  await page.waitForTimeout(1800);

  const [[saved]] = await c.query("SELECT content FROM cards WHERE id = ?", [card.insertId]);
  const stored = String(saved.content ?? "");
  const storedImages = (stored.match(/!\[/g) || []).length;
  check("one picture is stored", storedImages === 1, JSON.stringify(stored).slice(0, 120));
  check("and nothing points off the instance", !/theatre\.example/.test(stored));

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1400);
  const shown = await page.locator(".wysiwyg-wrapper img, .tiptap img").count();
  check("the reopened card draws one picture", shown === 1, `${shown} drawn`);
  const broken = await page.locator(".wysiwyg-wrapper img, .tiptap img").evaluateAll((nodes) =>
    nodes.filter((n) => !n.complete || n.naturalWidth === 0).length);
  check("and it is not broken", broken === 0, `${broken} broken`);

  // The control: a paste with no file must still paste as it always did.
  await openEditor();
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.setData("text/html", "<p>pasted <strong>text</strong></p>");
    transfer.setData("text/plain", "pasted text");
    document.querySelector(".tiptap").dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
    );
  });
  await page.waitForTimeout(600);
  check("pasting text with no picture in it still works",
    (await page.locator(".tiptap").first().innerText()).includes("pasted text"));
} catch (error) {
  console.error(`\n FAIL  the run stopped early — ${error.message.split("\n")[0]}`);
  failures++;
} finally {
  await stop();
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures ? 1 : 0);
