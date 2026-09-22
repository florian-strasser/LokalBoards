// A board, and My work, as a spreadsheet.
//
// Both downloads are started from their menus the way somebody would, and the
// files are read back as a spreadsheet would read them: split on the
// separator, quotes respected. An English instance separates with commas, a
// German one with semicolons and German headings, so each opens in Excel with a
// double-click. Every awkward thing a card can hold survives the trip — commas,
// quotes, line breaks, umlauts, a checklist — and a card title that looks like
// a formula stays text. Archived cards are not on the board, so they are not in
// the file; a board you cannot see is not yours to download.
//
// Requires a built app (`npm run build`) and the credentials in `.env.local`.
// Creates and drops a database of its own.
import fs from "node:fs";
import { spawn } from "node:child_process";
import mysql from "mysql2/promise";
import { chromium } from "playwright";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const DB = "lokalboards_csv";
const PORT = 3100, BASE = `http://127.0.0.1:${PORT}`;
const creds = { host: env.NUXT_MYSQL_HOST, user: env.NUXT_MYSQL_USER, password: env.NUXT_MYSQL_PASSWORD };

const admin = await mysql.createConnection(creds);
await admin.query(`DROP DATABASE IF EXISTS \`${DB}\``);
await admin.query(`CREATE DATABASE \`${DB}\``);
await admin.end();

let child;
const start = async (language) => {
  child = spawn("node", [".output/server/index.mjs"], {
    env: { ...process.env, ...env, NUXT_MYSQL_DATABASE: DB, NUXT_MYSQL_SSL: "false",
           NUXT_PUBLIC_SIGNUP: "true", PORT: String(PORT), NITRO_PORT: String(PORT),
           NUXT_BOARDS_URL: BASE, NUXT_LOG_LEVEL: "error", NUXT_LANGUAGE: language },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(BASE + "/api/health")).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("the server did not come up");
};
await start("en");
const c = await mysql.createConnection({ ...creds, database: DB });

let failures = 0;
let browser;
const stop = async () => {
  await browser?.close().catch(() => {});
  child?.kill("SIGKILL");
  await c.end().catch(() => {});
  const cleanup = await mysql.createConnection(creds);
  await cleanup.query(`DROP DATABASE IF EXISTS \`${DB}\``);
  await cleanup.end();
};

// What a spreadsheet does with the file: quoted fields may hold the separator,
// doubled quotes and line breaks.
const parse = (text, separator) => {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === separator) { row.push(field); field = ""; }
    else if (ch === "\r" && text[i + 1] === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; }
    else field += ch;
  }
  return rows;
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
    const cookie = (signIn.headers.getSetCookie?.() ?? []).map((x) => x.split(";")[0]).find((x) => x.startsWith("session_token="));
    const [[row]] = await c.query("SELECT id FROM `user` WHERE email = ?", [email]);
    await c.query("UPDATE `user` SET onboarded = 1 WHERE id = ?", [row.id]);
    return { id: row.id, cookie, token: cookie.split("=").slice(1).join("=") };
  };
  const owner = await account("Florian", "owner@example.test");
  const anna = await account("Anna Müller", "anna@example.test");
  const stranger = await account("Mallory", "mallory@example.test");

  const [board] = await c.execute("INSERT INTO boards (user, name, status) VALUES (?,?,?)", [owner.id, "Website, relaunch", "private"]);
  await c.execute("INSERT INTO invitations (board, user, permission) VALUES (?,?,?)", [board.insertId, anna.id, "edit"]);
  const area = async (name, sort, archived = false) =>
    (await c.execute("INSERT INTO areas (board, name, sort, archivedAt) VALUES (?,?,?,?)",
      [board.insertId, name, sort, archived ? new Date() : null]))[0].insertId;
  const todo = await area("To do", 0);
  const doing = await area("Doing", 1);
  const shelved = await area("Shelved", 2, true);
  const card = async (areaId, name, sort, fields = {}) => {
    const id = (await c.execute(
      "INSERT INTO cards (area, name, content, sort, status, dueDate, repeatEvery, archivedAt) VALUES (?,?,?,?,?,?,?,?)",
      [areaId, name, fields.content ?? "", sort, fields.status ?? 0, fields.dueDate ?? null, fields.repeatEvery ?? null, fields.archivedAt ?? null]))[0].insertId;
    for (const user of fields.people ?? []) await c.execute("INSERT INTO card_assignees (card, user) VALUES (?,?)", [id, user]);
    return id;
  };
  const due = new Date(2026, 9, 5, 9, 30);
  const tricky = await card(todo, 'Größe prüfen, "bitte" schnell', 0, {
    content: "Zwei Zeilen:\nerste, zweite\n\n- [x] one\n- [ ] two\n- [ ] three",
    dueDate: due, repeatEvery: "week", people: [owner.id, anna.id],
  });
  const formula = await card(todo, '=HYPERLINK("https://example.test","click")', 1);
  const finished = await card(doing, "Launch", 0, { status: 1 });
  await card(todo, "Archived card", 2, { archivedAt: new Date() });
  await card(shelved, "In an archived area", 0);
  const [label] = await c.execute("INSERT INTO labels (board, name, color, sort) VALUES (?,?,?,?)", [board.insertId, "Design", "#0066cc", 0]);
  const [label2] = await c.execute("INSERT INTO labels (board, name, color, sort) VALUES (?,?,?,?)", [board.insertId, "Copy", "#0066cc", 1]);
  await c.execute("INSERT INTO card_labels (card, label) VALUES (?,?),(?,?)", [tricky, label.insertId, tricky, label2.insertId]);
  await c.execute("INSERT INTO comments (card, user, content, date) VALUES (?,?,?,NOW())", [tricky, owner.id, "Looks good"]);

  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
  await context.addCookies([{ name: "session_token", value: owner.token, domain: "127.0.0.1", path: "/" }]);
  const page = await context.newPage();
  const download = async (open) => {
    const [file] = await Promise.all([page.waitForEvent("download"), open()]);
    return { name: file.suggestedFilename(), text: fs.readFileSync(await file.path(), "utf8") };
  };

  // --- A board -------------------------------------------------------------------
  console.log("\na board, from its menu");
  await page.goto(`${BASE}/board/${board.insertId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const file = await download(async () => {
    await page.locator('button[aria-haspopup="menu"]').last().click();
    await page.getByRole("button", { name: "Export as spreadsheet" }).click();
  });
  check("it downloads as a .csv named like the board's zip", /^\d+-website-relaunch-\d{4}-\d{2}-\d{2}\.csv$/.test(file.name), file.name);
  check("with a byte-order mark, so Excel reads it as UTF-8", file.text.charCodeAt(0) === 0xfeff);
  const rows = parse(file.text.slice(1), ",");
  check("separated by commas on an English instance",
    rows[0].join("|") === "Area|Card|Status|Due date|Repeat|Assigned to|Labels|Checklist|Comments|Attachments|Description|Link",
    rows[0].join("|"));
  check("one row per card on the board, archived ones left out, in the board's order",
    JSON.stringify(rows.slice(1).map((row) => row[1])) === JSON.stringify(['Größe prüfen, "bitte" schnell', '\'=HYPERLINK("https://example.test","click")', "Launch"]),
    JSON.stringify(rows.slice(1).map((row) => row[1])));
  const first = rows[1] ?? [];
  check("commas, quotes and umlauts in a title survive", first[1] === 'Größe prüfen, "bitte" schnell');
  check("so do line breaks in the description", first[10] === "Zwei Zeilen:\nerste, zweite\n\n- [x] one\n- [ ] two\n- [ ] three");
  check("everything about the card is there",
    first[0] === "To do" && first[2] === "Open" && first[3] === "2026-10-05 09:30" && first[4] === "Every week" &&
    first[5] === "Florian, Anna Müller" && first[6] === "Design, Copy" && first[7] === "1 of 3" && first[8] === "1" && first[9] === "0",
    JSON.stringify(first.slice(0, 10)));
  check("with a link back to the card", first[11] === `${BASE}/board/${board.insertId}?card=${tricky}`, first[11]);
  check("a title that looks like a formula stays text", rows[2]?.[1]?.startsWith("'="), rows[2]?.[1]);
  check("and a done card says so", rows[3]?.[2] === "Done" && rows[3]?.[0] === "Doing");

  const refused = await fetch(`${BASE}/api/data/board-export?boardId=${board.insertId}&format=csv`, { headers: { cookie: stranger.cookie } });
  check("somebody without access to the board gets nothing", refused.status === 403 || refused.status === 404, String(refused.status));

  // --- My work ---------------------------------------------------------------------
  console.log("\nMy work, from the dashboard's menu");
  await page.goto(`${BASE}/dashboard/?view=mine`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const mine = await download(async () => {
    await page.locator('button[aria-haspopup="menu"]').last().click();
    await page.getByRole("button", { name: "Export as spreadsheet" }).click();
  });
  const workRows = parse(mine.text.slice(1), ",");
  check("it is named for what it is", /^my-work-.*\.csv$/.test(mine.name), mine.name);
  check("it says which board each card is on", workRows[0][0] === "Board" && workRows[1]?.[0] === "Website, relaunch", JSON.stringify(workRows[1]?.slice(0, 3)));
  check("and holds only the open cards on me", workRows.length === 2 && workRows[1][2] === 'Größe prüfen, "bitte" schnell', String(workRows.length));
  await page.goto(`${BASE}/dashboard/`, { waitUntil: "networkidle" });
  await page.locator('button[aria-haspopup="menu"]').last().click();
  check("the entry is only offered on My work", (await page.getByRole("button", { name: "Export as spreadsheet" }).count()) === 0);

  // --- A German instance ---------------------------------------------------------------
  console.log("\non a German instance");
  child.kill("SIGKILL");
  await new Promise((r) => setTimeout(r, 500));
  await start("de");
  // Decoded by hand: `text()` would quietly drop the byte-order mark.
  const bytes = Buffer.from(await (await fetch(`${BASE}/api/data/board-export?boardId=${board.insertId}&format=csv`, { headers: { cookie: owner.cookie } })).arrayBuffer());
  check("it starts with the UTF-8 byte-order mark there too", bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf);
  const germanRows = parse(bytes.subarray(3).toString("utf8"), ";");
  check("it is separated by semicolons, with German headings",
    germanRows[0].slice(0, 5).join("|") === "Bereich|Karte|Status|Fälligkeitsdatum|Wiederholen", germanRows[0].join("|"));
  check("and German words in the cells",
    germanRows[1]?.[2] === "Offen" && germanRows[1]?.[4] === "Jede Woche" && germanRows[1]?.[7] === "1 von 3",
    JSON.stringify(germanRows[1]?.slice(2, 8)));
  check("a comma in a cell needs no quotes there, and still comes back whole", germanRows[1]?.[5] === "Florian, Anna Müller");
} catch (error) {
  console.error(`\n FAIL  the run stopped early — ${error.message.split("\n")[0]}`);
  failures++;
} finally {
  await stop();
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures ? 1 : 0);
