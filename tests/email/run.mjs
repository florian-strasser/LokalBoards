// Mail actually leaves the building.
//
// Everything the app sends — a welcome, an invitation, a password reset, the
// hourly digest — goes through the one transport in `app/lib/sendEmail.ts`,
// and that transport is Nodemailer. A major upgrade of it (9 to 10 in
// v0.40.0) is the kind of change that builds clean, passes every unit test and
// then quietly delivers nothing, because the part that broke is at the far end
// of a socket to a mail server no unit test has.
//
// So this run gives it one: a small SMTP server that speaks enough of the
// protocol to take a message and remember it. Then it asks the app for the
// mails people actually meet — the welcome on signing up, a password reset, an
// invitation to a board — and checks each arrived, that the server was asked
// for the password first, that the umlaut in a name survived, and that the
// links in the mails are ones the app itself accepts. It does the whole thing
// twice: once on a submission port with STARTTLS-less AUTH, and once on
// implicit TLS, which is what port 465 in the default config means and the
// half most instances use. Last it hands Nodemailer the inline avatar the
// digest attaches, because that mail runs on a cron rather than a request.
//
// Requires a built app (`npm run build`) and the credentials in `.env.local`.
// Creates and drops a database of its own. Needs openssl for the TLS half.
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import tls from "node:tls";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import mysql from "mysql2/promise";
import nodemailer from "nodemailer";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const DB = "lokalboards_email";
const PORT = 3100, BASE = `http://127.0.0.1:${PORT}`;
const creds = { host: env.NUXT_MYSQL_HOST, user: env.NUXT_MYSQL_USER, password: env.NUXT_MYSQL_PASSWORD };
const MAIL_USER = "post@example.test";
const MAIL_PASS = "smtp-secret-not-to-be-logged";

// --- A mail server ---------------------------------------------------------
// Enough SMTP for a client to hand a message over: a greeting, EHLO with AUTH
// offered, the envelope, then the data up to the lone dot. It keeps what it
// was told so the checks can look at it — including the credentials, to prove
// the app authenticates at all.
function mailServer({ secure = false, key, cert } = {}) {
  const inbox = [];
  const seen = { connections: 0, authCommands: 0, user: "", pass: "", encrypted: false };
  const talk = (socket) => {
    seen.connections++;
    if (socket.encrypted) seen.encrypted = true;
    let buffer = "", message = "", state = "command";
    let envelope = { from: "", to: [] };
    const say = (line) => socket.write(line + "\r\n");
    const line = (raw) => {
      if (state === "data") {
        if (raw === ".") {
          inbox.push({ ...envelope, raw: message });
          envelope = { from: "", to: [] };
          message = "";
          state = "command";
          return say("250 2.0.0 Ok: queued");
        }
        // Undo the dot a client stuffs in front of a line that starts with one.
        message += (raw.startsWith("..") ? raw.slice(1) : raw) + "\n";
        return;
      }
      if (state === "auth-user") {
        seen.user = Buffer.from(raw, "base64").toString("utf8");
        state = "auth-pass";
        return say("334 UGFzc3dvcmQ6");
      }
      if (state === "auth-pass") {
        seen.pass = Buffer.from(raw, "base64").toString("utf8");
        state = "command";
        return say("235 2.7.0 Accepted");
      }
      if (state === "auth-plain") {
        const parts = Buffer.from(raw, "base64").toString("utf8").split("\0");
        seen.user = parts[1] ?? "";
        seen.pass = parts[2] ?? "";
        state = "command";
        return say("235 2.7.0 Accepted");
      }
      const verb = raw.trim().split(/[ :]/)[0].toUpperCase();
      if (verb === "EHLO" || verb === "HELO") {
        say("250-localhost");
        say("250-AUTH PLAIN LOGIN");
        return say("250 8BITMIME");
      }
      if (verb === "AUTH") {
        seen.authCommands++;
        const [, mechanism, inline] = raw.trim().split(/\s+/);
        if (/PLAIN/i.test(mechanism)) {
          if (inline) {
            const parts = Buffer.from(inline, "base64").toString("utf8").split("\0");
            seen.user = parts[1] ?? "";
            seen.pass = parts[2] ?? "";
            return say("235 2.7.0 Accepted");
          }
          state = "auth-plain";
          return say("334 ");
        }
        state = "auth-user";
        return say("334 VXNlcm5hbWU6");
      }
      if (verb === "MAIL") {
        envelope.from = raw.match(/<([^>]*)>/)?.[1] ?? "";
        return say("250 2.1.0 Ok");
      }
      if (verb === "RCPT") {
        envelope.to.push(raw.match(/<([^>]*)>/)?.[1] ?? "");
        return say("250 2.1.5 Ok");
      }
      if (verb === "DATA") {
        state = "data";
        return say("354 End data with <CR><LF>.<CR><LF>");
      }
      if (verb === "QUIT") {
        say("221 2.0.0 Bye");
        return socket.end();
      }
      say("250 2.0.0 Ok");
    };
    say("220 localhost ESMTP test");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let at;
      while ((at = buffer.indexOf("\r\n")) !== -1) {
        const raw = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        line(raw);
      }
    });
    socket.on("error", () => {});
  };
  const server = secure ? tls.createServer({ key, cert }, talk) : net.createServer(talk);
  server.on("tlsClientError", () => {});
  return {
    inbox, seen,
    listen: () => new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port))),
    close: () => new Promise((r) => server.close(r)),
    waitFor: async (count) => {
      for (let i = 0; i < 80 && inbox.length < count; i++) await new Promise((r) => setTimeout(r, 250));
      return inbox.length >= count;
    },
  };
}

// --- Reading a mail --------------------------------------------------------
const decodePart = (body, encoding = "") => {
  const how = encoding.toLowerCase();
  if (how === "base64") return Buffer.from(body.replace(/\s/g, ""), "base64");
  if (how === "quoted-printable") {
    const undone = body.replace(/=\n/g, "")
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    return Buffer.from(undone, "binary");
  }
  return Buffer.from(body, "utf8");
};
// A subject with an umlaut travels as =?UTF-8?B?…?= and has to be put back.
const decodeWords = (text) =>
  text.replace(/=\?[^?]+\?([BbQq])\?([^?]*)\?=/g, (_, kind, encoded) =>
    kind.toUpperCase() === "B"
      ? Buffer.from(encoded, "base64").toString("utf8")
      : decodePart(encoded.replace(/_/g, " "), "quoted-printable").toString("utf8"));

function readMail(mail) {
  const split = mail.raw.indexOf("\n\n");
  const headers = {};
  mail.raw.slice(0, split).replace(/\n[ \t]+/g, " ").split("\n").forEach((line) => {
    const colon = line.indexOf(":");
    if (colon > 0) headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim();
  });
  const body = mail.raw.slice(split + 2);
  const type = headers["content-type"] ?? "";
  const boundary = type.match(/boundary="?([^";]+)"?/)?.[1];
  const parts = boundary
    ? body.split(`--${boundary}`).slice(1, -1).map((chunk) => readMail({ raw: chunk.replace(/^\r?\n/, "") }))
    : [];
  return {
    ...mail, headers, parts,
    subject: decodeWords(headers.subject ?? ""),
    // Every bit of text in the mail, whichever part it sits in.
    text: parts.length
      ? parts.map((p) => p.text).join("\n")
      : decodePart(body, headers["content-transfer-encoding"]).toString("utf8"),
    bytes: parts.length ? Buffer.alloc(0) : decodePart(body, headers["content-transfer-encoding"]),
  };
}

// --- The app ---------------------------------------------------------------
let child = null, serverSaid = "";
async function startApp(mailEnv) {
  child = spawn("node", [".output/server/index.mjs"], {
    env: { ...process.env, ...env, NUXT_MYSQL_DATABASE: DB, NUXT_MYSQL_SSL: "false",
           NUXT_PUBLIC_SIGNUP: "true", PORT: String(PORT), NITRO_PORT: String(PORT),
           NUXT_BOARDS_URL: BASE, NUXT_LOG_LEVEL: "info", NUXT_LANGUAGE: "en",
           NUXT_EMAIL_HOST: "127.0.0.1", NUXT_EMAIL_USER: MAIL_USER, NUXT_EMAIL_PASS: MAIL_PASS,
           ...mailEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => (serverSaid += chunk));
  child.stderr.on("data", (chunk) => (serverSaid += chunk));
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(BASE + "/api/health")).ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
const stopApp = async () => {
  child?.kill("SIGKILL");
  child = null;
  await new Promise((r) => setTimeout(r, 500));
};

let cookie = "";
async function api(path, body, method = "POST") {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const kept = res.headers.getSetCookie?.() ?? [];
  if (kept.length) cookie = kept.map((c) => c.split(";")[0]).join("; ");
  return { status: res.status, ok: res.ok, json: await res.json().catch(() => ({})) };
}

// --- The run ---------------------------------------------------------------
const work = fs.mkdtempSync(path.join(os.tmpdir(), "lokalboards-mail-"));
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
  "-keyout", `${work}/key.pem`, "-out", `${work}/cert.pem`,
  "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });

const admin = await mysql.createConnection(creds);
await admin.query(`DROP DATABASE IF EXISTS \`${DB}\``);
await admin.query(`CREATE DATABASE \`${DB}\``);
await admin.end();
const c = await mysql.createConnection({ ...creds, database: DB });

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
};
const cleanup = async () => {
  await stopApp();
  await c.end().catch(() => {});
  const last = await mysql.createConnection(creds);
  await last.query(`DROP DATABASE IF EXISTS \`${DB}\``);
  await last.end();
  fs.rmSync(work, { recursive: true, force: true });
};

try {
  // === On a submission port ===============================================
  console.log("\nplain connection, AUTH before anything is sent");
  const post = mailServer();
  const postPort = await post.listen();
  check("the app starts", await startApp({ NUXT_EMAIL_PORT: String(postPort), NUXT_EMAIL_SECURE: "false" }));

  const signUp = await api("/api/auth/sign-up",
    { name: "Anna Müller", email: "anna@example.test", password: "correct horse battery" });
  check("an account is created", signUp.ok, String(signUp.status));
  check("a welcome mail is sent", await post.waitFor(1), `${post.inbox.length} in the inbox`);

  const welcome = readMail(post.inbox[0] ?? { raw: "" });
  check("to the address that signed up, from the configured sender",
    (post.inbox[0]?.to ?? []).includes("anna@example.test") && post.inbox[0]?.from === MAIL_USER,
    JSON.stringify({ to: post.inbox[0]?.to, from: post.inbox[0]?.from }));
  check("the server was asked for the password first",
    post.seen.authCommands > 0 && post.seen.user === MAIL_USER && post.seen.pass === MAIL_PASS,
    `${post.seen.authCommands} AUTH, user ${post.seen.user === MAIL_USER ? "matches" : "wrong"}, password ${post.seen.pass === MAIL_PASS ? "matches" : "wrong"}`);
  check("it has a subject and an HTML body",
    !!welcome.subject && /text\/html/i.test(welcome.headers["content-type"] ?? ""), welcome.subject);
  check("the name survives with its umlaut", welcome.text.includes("Anna Müller"));
  check("and it links back to this instance", welcome.text.includes(BASE));

  console.log("\nasking for a new password");
  const asked = await api("/api/auth/request-password", { email: "anna@example.test" });
  check("the request is accepted", asked.ok, String(asked.status));
  check("a second mail arrives", await post.waitFor(2), `${post.inbox.length} in the inbox`);
  const letter = readMail(post.inbox[1] ?? { raw: "" });
  check("addressed to her", (post.inbox[1]?.to ?? []).includes("anna@example.test"));

  const link = letter.text.match(/https?:\/\/[^"'\s<>]*reset-password\/[0-9a-f-]{36}/i)?.[0];
  check("carrying a reset link to this instance", !!link && link.startsWith(BASE), String(link));
  const token = link?.split("/").pop() ?? "";
  const [[kept]] = await c.query("SELECT COUNT(*) AS n FROM `verification` WHERE `value` = ?", [token]);
  check("whose token is the one the app stored", Number(kept.n) === 1);

  const used = await api("/api/auth/reset-password", { token, newPassword: "a whole new password" });
  check("following the link sets the new password", used.ok, String(used.status));
  cookie = "";
  const signIn = await api("/api/auth/sign-in", { email: "anna@example.test", password: "a whole new password" });
  check("and she can sign in with it", signIn.ok, String(signIn.status));

  console.log("\ninviting somebody who has no account yet");
  const [[anna]] = await c.query("SELECT id FROM `user` WHERE `email` = ?", ["anna@example.test"]);
  const made = await api("/api/data/board",
    { userId: anna?.id, name: "Mail test", style: "kanban", image: null, color: "", status: "private" });
  check("a board to invite to", made.ok, String(made.status));
  const [[board]] = await c.query("SELECT id FROM `boards` ORDER BY id DESC LIMIT 1");
  const invited = await api("/api/data/invite",
    { boardId: board?.id, mail: "bert@example.test", permission: "edit" });
  check("the invitation is made", invited.ok, String(invited.status));
  check("an invitation mail arrives", await post.waitFor(3), `${post.inbox.length} in the inbox`);
  const invite = readMail(post.inbox[2] ?? { raw: "" });
  check("to the address invited", (post.inbox[2]?.to ?? []).includes("bert@example.test"));
  check("naming the board and who invited him",
    invite.text.includes("Mail test") && invite.text.includes("Anna Müller"));

  const inviteToken = invite.text.match(/invite=([a-f0-9]{64})/i)?.[1];
  check("with a sign-up link that carries a token", !!inviteToken);
  cookie = "";
  const joined = await api("/api/auth/sign-up",
    { name: "Bert Brecht", password: "another good password", inviteToken });
  check("which the app accepts, onto that board", joined.ok, String(joined.status));
  const [[member]] = await c.query(
    "SELECT COUNT(*) AS n FROM `invitations` i JOIN `user` u ON u.id = i.user WHERE i.board = ? AND u.email = ?",
    [board?.id, "bert@example.test"]);
  check("and he is on it", Number(member.n) === 1);

  // === On implicit TLS (port 465, the default config) ======================
  console.log("\nimplicit TLS, the way port 465 works");
  await stopApp();
  await post.close();
  const wrapped = mailServer({ secure: true, key: fs.readFileSync(`${work}/key.pem`), cert: fs.readFileSync(`${work}/cert.pem`) });
  const tlsPort = await wrapped.listen();
  check("the app starts against a TLS mail server",
    await startApp({ NUXT_EMAIL_PORT: String(tlsPort), NUXT_EMAIL_SECURE: "true",
                     NODE_EXTRA_CA_CERTS: `${work}/cert.pem` }));
  const askedAgain = await api("/api/auth/request-password", { email: "anna@example.test" });
  check("a reset is requested", askedAgain.ok, String(askedAgain.status));
  check("the mail arrives over the encrypted connection",
    (await wrapped.waitFor(1)) && wrapped.seen.encrypted, `${wrapped.inbox.length} in the inbox`);
  const overTls = readMail(wrapped.inbox[0] ?? { raw: "" });
  check("intact, with its reset link", /reset-password\/[0-9a-f-]{36}/i.test(overTls.text));
  check("and it authenticated there too", wrapped.seen.pass === MAIL_PASS);
  await stopApp();
  await wrapped.close();

  // === The digest's inline avatars ========================================
  // The hourly digest is the one mail with attachments, and the only one that
  // runs on a cron rather than a request — so its attachment is handed to
  // Nodemailer here the way the task builds it.
  console.log("\nthe inline avatar the digest attaches");
  const catcher = mailServer();
  const catcherPort = await catcher.listen();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64");
  const transport = nodemailer.createTransport({
    host: "127.0.0.1", port: catcherPort, secure: false,
    auth: { user: MAIL_USER, pass: MAIL_PASS },
  });
  await transport.sendMail({
    from: MAIL_USER, to: "anna@example.test", subject: "Your unread notifications",
    html: `<img src="cid:avatar0@lokalboards" width="32">`,
    attachments: [{
      cid: "avatar0@lokalboards", filename: "avatar0.png", content: png,
      contentType: "image/png", contentDisposition: "inline",
      __source: "data:image/png;base64,…",
    }],
  });
  check("the digest mail goes out", await catcher.waitFor(1));
  const digest = readMail(catcher.inbox[0] ?? { raw: "" });
  check("as a related multipart, so the image belongs to the body",
    /multipart\/related/i.test(digest.headers["content-type"] ?? ""), digest.headers["content-type"]);
  const image = digest.parts.find((p) => /image\/png/i.test(p.headers["content-type"] ?? ""));
  check("the avatar is attached inline under its cid",
    !!image && (image.headers["content-id"] ?? "").includes("avatar0@lokalboards"),
    image?.headers["content-id"]);
  check("and arrives byte for byte", !!image && image.bytes.equals(png));
  check("the body still points at it", digest.text.includes("cid:avatar0@lokalboards"));
  await catcher.close();

  check("no SMTP password anywhere in what the server logged", !serverSaid.includes(MAIL_PASS));
} catch (error) {
  console.error(`\n FAIL  the run stopped early — ${error.message.split("\n")[0]}`);
  failures++;
} finally {
  await cleanup();
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures ? 1 : 0);
