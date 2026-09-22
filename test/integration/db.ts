import { setupDatabase, runMigrations } from "../../app/lib/databaseSetup";

// Data tables to clear between tests (excludes `migrations`, which is left
// intact so the schema is only built once).
const DATA_TABLES = [
  "account",
  "apikey",
  "boards",
  "areas",
  "cards",
  "card_assignees",
  "card_reminders",
  "attachments",
  "comments",
  "invitations",
  "notifications",
  "session",
  "user",
  "verification",
  "webhooks",
];

// Written by migration 0007 rather than by the app. They are keyed by row id and
// record which rows have already been converted, so a test that re-inserts
// card id 1 must start from an empty backup or its content is (correctly)
// treated as already migrated.
const MIGRATION_TABLES = [
  "cards_content_html_backup",
  "comments_content_html_backup",
];

export function db() {
  return setupDatabase();
}

// Build the schema once (runs the real migrations against the test database).
export async function migrate() {
  await runMigrations();
}

// Empty all data tables for an isolated test.
export async function resetData() {
  const pool = setupDatabase();
  await pool.query("SET FOREIGN_KEY_CHECKS=0");
  for (const table of DATA_TABLES) {
    await pool.query(`TRUNCATE TABLE \`${table}\``);
  }
  for (const table of MIGRATION_TABLES) {
    // Dropped, not truncated: the migration recreates it with CREATE TABLE IF
    // NOT EXISTS, and it may not exist yet on a fresh database.
    await pool.query(`DROP TABLE IF EXISTS \`${table}\``);
  }
  await pool.query("SET FOREIGN_KEY_CHECKS=1");
}

export async function insertUser(
  id: string,
  overrides: { banned?: number; role?: string; email?: string } = {},
) {
  await setupDatabase().execute(
    "INSERT INTO `user` (`id`,`name`,`email`,`emailVerified`,`role`,`banned`) VALUES (?,?,?,?,?,?)",
    [
      id,
      "Test User",
      overrides.email ?? `${id}@example.com`,
      1,
      overrides.role ?? "user",
      overrides.banned ?? null,
    ],
  );
}
