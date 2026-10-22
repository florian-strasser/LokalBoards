// Scratch: a throwaway instance with a board like the reported one; runs until killed.
import fs from "node:fs";
import { spawn } from "node:child_process";
import mysql from "mysql2/promise";
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split("\n")
  .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
const DB = "lokalboards_repro_wrap", PORT = 3100, BASE = `http://127.0.0.1:${PORT}`;
const creds = { host: env.NUXT_MYSQL_HOST, user: env.NUXT_MYSQL_USER, password: env.NUXT_MYSQL_PASSWORD };
const admin = await mysql.createConnection(creds);
await admin.query(`DROP DATABASE IF EXISTS \`${DB}\``); await admin.query(`CREATE DATABASE \`${DB}\``); await admin.end();
const child = spawn("node", [".output/server/index.mjs"], {
  env: { ...process.env, ...env, NUXT_MYSQL_DATABASE: DB, NUXT_MYSQL_SSL: "false", NUXT_PUBLIC_SIGNUP: "true",
         PORT: String(PORT), NITRO_PORT: String(PORT), NUXT_BOARDS_URL: BASE, NUXT_LOG_LEVEL: "error", NUXT_LANGUAGE: "de" },
  stdio: ["ignore", "ignore", "ignore"] });
for (let i = 0; i < 160; i++) { try { if ((await fetch(BASE + "/api/health")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
const c = await mysql.createConnection({ ...creds, database: DB });
await fetch(`${BASE}/api/auth/sign-up`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "Florian", email: "owner@example.test", password: "correct horse battery" }) });
const signIn = await fetch(`${BASE}/api/auth/sign-in`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "owner@example.test", password: "correct horse battery" }) });
const cookie = (signIn.headers.getSetCookie?.() ?? []).map((x) => x.split(";")[0]).find((x) => x.startsWith("session_token="));
const [[me]] = await c.query("SELECT id FROM `user` WHERE email = 'owner@example.test'");
await c.query("UPDATE `user` SET onboarded = 1 WHERE id = ?", [me.id]);
const [board] = await c.execute("INSERT INTO boards (user, name, status) VALUES (?,?,?)", [me.id, "Eventfalcon", "private"]);
const titles = ["Abotermine ...", "widget", "Veranstaltungen löschen über die Tonne", "QR-Code für Orte",
  "Registrierung auch mit Google oder Apple", "Acalendar", "Social Media"];
let target;
for (const [i, name] of ["Prio 1", "Prio 2", "Erledigt", "Aufgaben für Falk", "Local Boards Ergänzungen"].entries()) {
  const [area] = await c.execute("INSERT INTO areas (board, name, sort) VALUES (?,?,?)", [board.insertId, name, i]);
  for (const [j, t] of titles.entries()) {
    const [card] = await c.execute("INSERT INTO cards (area, name, content, status, sort) VALUES (?, ?, 'Sollten wir sowas vielleicht auch noch anbieten?', 0, ?)", [area.insertId, i === 0 ? t : `${t} ${i}`, j]);
    if (i === 0 && t.startsWith("Registrierung")) target = card.insertId;
  }
}
await c.end();
fs.writeFileSync(process.argv[2], JSON.stringify({ base: BASE, board: board.insertId, card: target, token: cookie.split("=").slice(1).join("=") }));
const stop = async () => {
  child.kill("SIGKILL");
  const cleanup = await mysql.createConnection(creds);
  await cleanup.query(`DROP DATABASE IF EXISTS \`${DB}\``); await cleanup.end();
  process.exit(0);
};
process.on("SIGTERM", stop); process.on("SIGINT", stop);
setInterval(() => {}, 1 << 30);
