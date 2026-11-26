// What a board member can make the instance serve, and to whom.
//
// A card's files used to be taken as sent: a type of `text/html` and a script
// in base64 were kept as they were, and opening the file showed the page on
// the instance's own address, where its script ran as whoever opened it. An
// address in place of the file sent them wherever it said. This checks that a
// file has to be what it claims and point nowhere else, that whatever is
// stored already is only ever shown in a tab when it is a picture or a PDF,
// that pages carry the headers that hold the rest, that the instance's colour
// settings cannot add markup to a page, and that somebody who may only look at
// a board cannot announce changes to the others on it.
//
// Requires a built app (`npm run build`) and the credentials in `.env.local`.
// Creates and drops a database of its own; it never touches an existing one.
import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import mysql from "mysql2/promise";
import { io } from "socket.io-client";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const DB = "lokalboards_security";
const PORT = 3100, BASE = `http://127.0.0.1:${PORT}`;
const creds = { host: env.NUXT_MYSQL_HOST, user: env.NUXT_MYSQL_USER, password: env.NUXT_MYSQL_PASSWORD };

const admin = await mysql.createConnection(creds);
await admin.query(`DROP DATABASE IF EXISTS \`${DB}\``);
await admin.query(`CREATE DATABASE \`${DB}\``);
await admin.end();

const child = spawn("node", [".output/server/index.mjs"], {
  env: { ...process.env, ...env, NUXT_MYSQL_DATABASE: DB, NUXT_MYSQL_SSL: "false",
         NUXT_PUBLIC_SIGNUP: "true", PORT: String(PORT), NITRO_PORT: String(PORT),
         NUXT_BOARDS_URL: BASE, NUXT_LOG_LEVEL: "error", NUXT_LANGUAGE: "en",
         // Settings that try to leave the value they are written into, and
         // one ordinary colour that is not hex.
         NUXT_PUBLIC_COLOR_PRIMARY: 'red"/><script>alert(1)</script><path d="',
         NUXT_PUBLIC_COLOR_GRAY: "#fff;}</style><script>alert(2)</script><style>",
         NUXT_PUBLIC_COLOR_SLATE: "rgb(245 245 247)" },
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
const sockets = [];
const stop = async () => {
  for (const socket of sockets) socket.close();
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
  const post = (path, body, headers = {}) => fetch(`${BASE}${path}`, {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  });
  const account = async (name, email) => {
    await post("/api/auth/sign-up", { name, email, password: "correct horse battery" });
    const signIn = await post("/api/auth/sign-in", { email, password: "correct horse battery" });
    const cookie = (signIn.headers.getSetCookie?.() ?? []).map((x) => x.split(";")[0])
      .find((x) => x.startsWith("session_token="));
    const [[row]] = await c.query("SELECT id FROM `user` WHERE email = ?", [email]);
    await c.query("UPDATE `user` SET onboarded = 1 WHERE id = ?", [row.id]);
    return { id: row.id, cookie };
  };
  const owner = await account("Owner", "owner@example.test");
  const reader = await account("Reader", "reader@example.test");
  const editor = await account("Editor", "editor@example.test");

  const [board] = await c.execute("INSERT INTO boards (user, name, status) VALUES (?,?,?)", [owner.id, "Files", "private"]);
  const boardId = board.insertId;
  await c.execute("INSERT INTO invitations (board, user, permission) VALUES (?,?,?)", [boardId, reader.id, "read"]);
  await c.execute("INSERT INTO invitations (board, user, permission) VALUES (?,?,?)", [boardId, editor.id, "edit"]);
  const [area] = await c.execute("INSERT INTO areas (board, name, sort) VALUES (?,?,?)", [boardId, "Todo", 0]);
  const [card] = await c.execute("INSERT INTO cards (area, name, content, sort) VALUES (?,?,?,?)",
    [area.insertId, "Original", "", 0]);
  const cardId = card.insertId;

  const b64 = (text) => Buffer.from(text).toString("base64");
  const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const PDF = b64("%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");
  const SCRIPT = "<html><body><script>fetch('/api/data/boards')</script></body></html>";
  const putCard = (files, as = editor) => fetch(`${BASE}/api/data/card`, {
    method: "PUT", headers: { "content-type": "application/json", cookie: as.cookie },
    body: JSON.stringify({ cardID: cardId, name: "Changed", files }),
  });
  const upload = async (bytes, type, name) => {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type }), name);
    return fetch(`${BASE}/api/upload`, { method: "POST", headers: { cookie: editor.cookie }, body: form })
      .then((r) => r.json());
  };

  // ---------------------------------------------------- files sent in ----
  console.log("\nfiles sent with a card");
  const refused = async (name, file) => {
    const res = await putCard([file]);
    check(name, res.status === 400, String(res.status));
  };
  await refused("a page sent as a file is refused", { filename: "x.html", filetype: "text/html", filedata: b64(SCRIPT) });
  await refused("so is a page that claims to be a PDF", { filename: "x.pdf", filetype: "application/pdf", filedata: b64(SCRIPT) });
  await refused("an SVG, which a browser would run", { filename: "x.svg", filetype: "image/svg+xml", filedata: b64("<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>") });
  await refused("an address on another site", { filename: "x.pdf", filetype: "application/pdf", filedata: "https://evil.example/x.pdf" });
  await refused("one that only a browser reads as another site", { filename: "x.pdf", filetype: "application/pdf", filedata: "//evil.example/x.pdf" });
  await refused("and a file of ours that is not there", { filename: "x.pdf", filetype: "application/pdf", filedata: "/api/uploads/0123456789abcdef0123456789abcdef.pdf" });
  const [[untouched]] = await c.query("SELECT name FROM cards WHERE id = ?", [cardId]);
  const [[noneKept]] = await c.query("SELECT COUNT(*) AS n FROM attachments WHERE card = ?", [cardId]);
  check("and a refusal changes nothing on the card", untouched.name === "Original" && noneKept.n === 0,
    `${untouched.name}, ${noneKept.n} files`);

  const png = await putCard([{ filename: "dot.png", filetype: "image/png", filesize: 1, filedata: PNG }]);
  const pngBody = await png.json();
  const kept = pngBody.attachments?.[0] ?? {};
  check("a picture in base64 is taken", png.status === 200, String(png.status));
  check("and kept as an uploaded file", /^\/api\/uploads\/[0-9a-f]{32}\.png$/.test(kept.filedata ?? ""), kept.filedata);
  check("with its own size, not the one it was sent with", kept.filesize === Buffer.from(PNG, "base64").length, String(kept.filesize));

  const uploadedPdf = await upload(Buffer.from(PDF, "base64"), "application/pdf", "report.pdf");
  const named = await putCard([{ filename: "report.pdf", filetype: "text/html", filesize: 1, filedata: uploadedPdf.url }]);
  const namedRow = (await named.json()).attachments?.[0] ?? {};
  check("a file uploaded first is attached by its address", named.status === 200 && namedRow.filedata === uploadedPdf.url,
    `${named.status} ${namedRow.filedata}`);
  check("with the type it proved on upload, whatever the request says", namedRow.filetype === "application/pdf", namedRow.filetype);

  // --------------------------------------------------- files served ------
  console.log("\nfiles already stored");
  // As an import or an older version could have left them.
  const stored = async (filetype, filedata) => {
    const [row] = await c.execute(
      "INSERT INTO attachments (card, filename, filetype, filesize, filedata) VALUES (?,?,?,?,?)",
      [cardId, "file", filetype, 10, filedata],
    );
    return row.insertId;
  };
  const get = (id, mode = "raw") => fetch(`${BASE}/api/data/attachment?id=${id}&${mode}=1`,
    { headers: { cookie: reader.cookie }, redirect: "manual" });
  const savedNotShown = async (name, res) => {
    check(name,
      res.status === 200
        && res.headers.get("content-type") === "application/octet-stream"
        && /^attachment/.test(res.headers.get("content-disposition") ?? "")
        && res.headers.get("x-content-type-options") === "nosniff",
      `${res.status} ${res.headers.get("content-type")} ${res.headers.get("content-disposition")}`);
  };
  await savedNotShown("a stored page is sent to be saved, never shown", await get(await stored("text/html", b64(SCRIPT))));
  await savedNotShown("and so is a stored SVG", await get(await stored("image/svg+xml", b64("<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>"))));
  await savedNotShown("asked for as a download as well", await get(await stored("text/html", b64(SCRIPT)), "download"));
  const pdfShown = await get(await stored("application/pdf", PDF));
  check("a stored PDF is still shown in the tab",
    pdfShown.headers.get("content-type") === "application/pdf" && /^inline/.test(pdfShown.headers.get("content-disposition") ?? ""),
    `${pdfShown.headers.get("content-type")} ${pdfShown.headers.get("content-disposition")}`);

  for (const [name, address] of [
    ["an address on another site", "https://evil.example/x"],
    ["an address only a browser reads as another site", "//evil.example/x"],
  ]) {
    const res = await get(await stored("application/pdf", address));
    check(`a stored file that is ${name} is not followed`, res.status === 404 && !res.headers.get("location"),
      `${res.status} ${res.headers.get("location") ?? ""}`);
  }
  const ownName = uploadedPdf.url.split("/").pop();
  const own = await get(await stored("application/pdf", uploadedPdf.url));
  check("one of the instance's own files is", own.status === 302 && own.headers.get("location") === `/api/uploads/${ownName}`,
    `${own.status} ${own.headers.get("location")}`);
  const older = await get(await stored("application/pdf", `https://old-name.example/uploads/${ownName}`));
  check("also when an older row holds its whole address — to the file here",
    older.status === 302 && older.headers.get("location") === `/api/uploads/${ownName}`,
    `${older.status} ${older.headers.get("location")}`);

  // ------------------------------------------- files brought by an import --
  console.log("\nfiles brought by an import");
  // A Wekan export carries its files' bytes and says what type each one is.
  // The import keeps that type; what it may do is decided when it is served.
  const wekan = JSON.parse(fs.readFileSync("test/fixtures/import/wekan-board.json", "utf8"));
  const onCard = wekan.cards[0]._id;
  wekan.attachments = [
    { _id: "page", cardId: onCard, name: "page.html", type: "text/html", file: b64(SCRIPT) },
    { _id: "svg", cardId: onCard, name: "logo.svg", type: "image/svg+xml",
      file: b64("<svg xmlns='http://www.w3.org/2000/svg'><script>fetch('/api/data/boards')</script></svg>") },
    { _id: "fake", cardId: onCard, name: "photo.png", type: "image/png", file: b64(SCRIPT) },
    { _id: "pdf", cardId: onCard, name: "notes.pdf", type: "application/pdf", file: PDF },
  ];
  const imported = await fetch(`${BASE}/api/data/import/file`, {
    method: "POST", headers: { "content-type": "application/json", cookie: owner.cookie }, body: JSON.stringify(wekan),
  }).then((r) => r.json());
  const [importedFiles] = await c.query(
    "SELECT a.id, a.filename FROM attachments a JOIN cards k ON k.id = a.card JOIN areas ar ON ar.id = k.area WHERE ar.board = ?",
    [imported.boards?.[0]?.id ?? 0],
  );
  const importedFile = (name) => importedFiles.find((row) => row.filename === name)?.id;
  check("a crafted export is imported with its four files", importedFiles.length === 4, JSON.stringify(imported).slice(0, 100));
  const [keptTypes] = await c.query("SELECT filename, filetype FROM attachments WHERE id IN (?)", [importedFiles.map((row) => row.id)]);
  const typeOf = (name) => keptTypes.find((row) => row.filename === name)?.filetype;
  check("the import keeps a type only where the file bears it out",
    typeOf("page.html") === "application/octet-stream" && typeOf("logo.svg") === "application/octet-stream"
      && typeOf("photo.png") === "application/octet-stream" && typeOf("notes.pdf") === "application/pdf",
    JSON.stringify(keptTypes.map((row) => [row.filename, row.filetype])));
  const openAsOwner = (id) => fetch(`${BASE}/api/data/attachment?id=${id}&raw=1`, { headers: { cookie: owner.cookie }, redirect: "manual" });
  await savedNotShown("an imported page is sent to be saved, never shown", await openAsOwner(importedFile("page.html")));
  await savedNotShown("and so is an imported SVG with a script in it", await openAsOwner(importedFile("logo.svg")));
  await savedNotShown("and a page passed off as a picture", await openAsOwner(importedFile("photo.png")));
  const importedPdf = await openAsOwner(importedFile("notes.pdf"));
  check("an imported PDF still opens in the tab",
    importedPdf.headers.get("content-type") === "application/pdf" && /^inline/.test(importedPdf.headers.get("content-disposition") ?? ""));

  const servedPdf = await fetch(`${BASE}${uploadedPdf.url}`);
  check("an uploaded PDF is shown in the tab",
    /^inline/.test(servedPdf.headers.get("content-disposition") ?? "") && servedPdf.headers.get("x-content-type-options") === "nosniff",
    servedPdf.headers.get("content-disposition"));
  check("and kept by the browser alone, not by a CDN or proxy in front",
    /^private\b/.test(servedPdf.headers.get("cache-control") ?? ""), servedPdf.headers.get("cache-control"));
  const csv = await upload(Buffer.from("a,b\n1,2\n"), "text/csv", "list.csv");
  const servedCsv = await fetch(`${BASE}${csv.url}`);
  check("an uploaded spreadsheet is sent to be saved", /^attachment/.test(servedCsv.headers.get("content-disposition") ?? ""),
    servedCsv.headers.get("content-disposition"));

  // ------------------------------------------------------------ headers ----
  console.log("\nheaders");
  const page = await fetch(`${BASE}/`);
  const csp = page.headers.get("content-security-policy") ?? "";
  check("a page may only be framed by the instance itself",
    page.headers.get("x-frame-options") === "SAMEORIGIN" && csp.includes("frame-ancestors 'self'"), csp);
  check("loads no plugin content and keeps its <base>", csp.includes("object-src 'none'") && csp.includes("base-uri 'self'"));
  check("keeps its address from other sites", page.headers.get("referrer-policy") === "same-origin");
  check("and is not sniffed", page.headers.get("x-content-type-options") === "nosniff");
  const api = await fetch(`${BASE}/api/health`);
  check("the API is framed by the instance alone too, without the rest of the policy",
    (api.headers.get("content-security-policy") ?? "") === "frame-ancestors 'self'", api.headers.get("content-security-policy"));

  // ------------------------------------------------------------ colours ----
  console.log("\ncolour settings");
  const favicon = await fetch(`${BASE}/favicon.svg`).then((r) => r.text());
  check("a primary colour that is not one gives the favicon the default",
    favicon.includes('fill="#0066CC"') && !favicon.includes("<script"));
  const html = await page.text();
  const style = html.match(/<style[^>]*>([^<]*--color-[\s\S]*?)<\/style>/)?.[1] ?? "";
  check("a colour setting cannot add markup to the page", !html.includes("<script>alert"));
  check("such a setting is left out, and the default stands", !!style && !style.includes("alert") && !/--color-gray:/.test(style.split("@media")[0]),
    style.replace(/\s+/g, " ").slice(0, 120));
  check("while a colour written another way still applies", style.includes("--color-slate: rgb(245 245 247);"));

  // ------------------------------------------------------------- sockets ---
  console.log("\nlive updates");
  const connect = (who) => new Promise((resolve) => {
    const socket = io(BASE, { extraHeaders: { cookie: who.cookie }, transports: ["websocket"], reconnection: false });
    sockets.push(socket);
    socket.on("connect", () => resolve(socket));
  });
  const [asOwner, asReader, asEditor] = await Promise.all([connect(owner), connect(reader), connect(editor)]);
  for (const socket of [asOwner, asReader, asEditor]) {
    socket.emit("joinBoard", { boardId });
    socket.emit("joinCard", { cardID: cardId, boardID: boardId });
  }
  await new Promise((r) => setTimeout(r, 800));
  const heard = (socket, event, ms = 1000) => new Promise((resolve) => {
    const timer = setTimeout(() => { socket.off(event, on); resolve(null); }, ms);
    const on = (payload) => { clearTimeout(timer); socket.off(event, on); resolve(payload); };
    socket.on(event, on);
  });
  const fake = { id: cardId, name: "Never written", area: area.insertId };

  let arrived = heard(asOwner, "updateCard");
  asReader.emit("cardUpdated", { boardId, card: fake, attachments: [] });
  check("somebody who may only look cannot announce a changed card", (await arrived) === null);
  arrived = heard(asOwner, "addComment");
  asReader.emit("commentCreated", { cardID: cardId, comment: { id: 999, content: "Never written", userName: "Owner" } });
  check("nor a comment", (await arrived) === null);
  arrived = heard(asReader, "updateCard");
  asEditor.emit("cardUpdated", { boardId, card: { ...fake, name: "Renamed" }, attachments: [] });
  check("somebody who may edit can, and those who look still hear it", (await arrived)?.card?.name === "Renamed");
  arrived = heard(asOwner, "updateBoard");
  asEditor.emit("boardUpdated", { boardID: boardId, boardName: "Taken over" });
  check("a board's settings are announced by its owner only", (await arrived) === null);
  arrived = heard(asEditor, "updateBoard");
  asOwner.emit("boardUpdated", { boardID: boardId, boardName: "Files, renamed" });
  check("as they are by the owner", !!(await arrived));

  // ----------------------------------------------------- one link, once ----
  console.log("\npassword links");
  await account("Reset", "reset@example.test");
  const link = randomUUID();
  await c.execute("INSERT INTO verification (id, identifier, value, expiresAt) VALUES (?,?,?, NOW() + INTERVAL 1 DAY)",
    [randomUUID(), "reset@example.test", createHash("sha256").update(link).digest("hex")]);
  const resets = await Promise.all(["first new password", "second new password", "third new password"]
    .map((newPassword) => post("/api/auth/reset-password", { token: link, newPassword }).then((r) => r.status)));
  check("a reset link sent three times at once sets one password", resets.filter((s) => s === 200).length === 1,
    resets.join(", "));

  // ------------------------------------------------------ wrong keys ------
  // Last: it locks keys out from this address for a quarter of an hour.
  console.log("\nwrong keys");
  const withKey = () => fetch(`${BASE}/api/data/my-work`, { headers: { "x-api-key": "lb_" + randomUUID().replace(/-/g, "") } })
    .then((r) => r.status);
  const statuses = [];
  for (let i = 0; i < 31; i++) statuses.push(await withKey());
  check("thirty wrong API keys are each refused as wrong",
    statuses.slice(0, 30).every((s) => s === 401 || s === 403), [...new Set(statuses.slice(0, 30))].join(","));
  check("and the next is turned away before it is looked up", statuses[30] === 429, String(statuses[30]));
  const mcp = await fetch(`${BASE}/mcp`, { method: "POST",
    headers: { authorization: "Bearer not-a-token", "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  check("on the MCP endpoint as well", mcp.status === 429, String(mcp.status));
  const signedIn = await fetch(`${BASE}/api/data/my-work`, { headers: { cookie: owner.cookie } });
  check("while somebody signed in from the same address goes on working", signedIn.status === 200, String(signedIn.status));
} catch (error) {
  console.error(`\n FAIL  the run stopped early — ${error.message.split("\n")[0]}`);
  failures++;
} finally {
  await stop();
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures ? 1 : 0);
