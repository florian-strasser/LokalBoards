import { createHash } from "node:crypto";
import {
  OWNER_ID,
  EDITOR_ID,
  OWNER_TOKEN,
  EDITOR_TOKEN,
  BOARD_ID,
  AREA_ID,
} from "./fixtures";

// Seeds the throwaway test database with a board, an area, an owner and an
// edit-invited collaborator, plus a session per user (so the browser contexts
// can authenticate by setting the session_token cookie directly). Never point
// this at real data — it truncates tables.
// Sessions are stored by the token's hash (hashToken in server/utils/auth.ts,
// not imported here: it would open the pool before the env below is set). The
// cookie the browser sets holds the token itself.
const sha256 = (token: string) =>
  createHash("sha256").update(token, "utf8").digest("hex");

export default async function globalSetup() {
  // Map TEST_MYSQL_* onto the NUXT_MYSQL_* vars databaseSetup reads, BEFORE
  // importing it (its pool is created at import time).
  process.env.NUXT_MYSQL_HOST = process.env.TEST_MYSQL_HOST ?? "127.0.0.1";
  process.env.NUXT_MYSQL_PORT = process.env.TEST_MYSQL_PORT ?? "";
  process.env.NUXT_MYSQL_USER = process.env.TEST_MYSQL_USER ?? "root";
  process.env.NUXT_MYSQL_PASSWORD = process.env.TEST_MYSQL_PASSWORD ?? "";
  process.env.NUXT_MYSQL_DATABASE =
    process.env.TEST_MYSQL_DATABASE ?? "lokalboards_test";
  process.env.NUXT_MYSQL_SSL = "false";

  const { setupDatabase, runMigrations } = await import(
    "../../app/lib/databaseSetup"
  );

  await runMigrations();
  const db = setupDatabase();

  await db.query("SET FOREIGN_KEY_CHECKS=0");
  for (const t of [
    "boards",
    "areas",
    "cards",
    "invitations",
    "session",
    "user",
    "comments",
    "notifications",
    "attachments",
  ]) {
    await db.query(`TRUNCATE TABLE \`${t}\``);
  }
  await db.query("SET FOREIGN_KEY_CHECKS=1");

  await db.execute(
    "INSERT INTO `user` (id, name, email, emailVerified, role) VALUES (?,?,?,?,?), (?,?,?,?,?)",
    [
      OWNER_ID, "Owner", "owner@example.com", 1, "user",
      EDITOR_ID, "Editor", "editor@example.com", 1, "user",
    ],
  );

  await db.execute(
    "INSERT INTO `boards` (id, user, name, status) VALUES (?,?,?,?)",
    [BOARD_ID, OWNER_ID, "Multiplayer Test", "private"],
  );

  await db.execute(
    "INSERT INTO `invitations` (board, user, permission) VALUES (?,?,?)",
    [BOARD_ID, EDITOR_ID, "edit"],
  );

  await db.execute(
    "INSERT INTO `areas` (id, board, name, sort) VALUES (?,?,?,?)",
    [AREA_ID, BOARD_ID, "To Do", 0],
  );

  const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.execute(
    "INSERT INTO `session` (id, expiresAt, token, userId) VALUES (?,?,?,?), (?,?,?,?)",
    [
      "pw-sess-owner", future, sha256(OWNER_TOKEN), OWNER_ID,
      "pw-sess-editor", future, sha256(EDITOR_TOKEN), EDITOR_ID,
    ],
  );

  await db.end();
}
