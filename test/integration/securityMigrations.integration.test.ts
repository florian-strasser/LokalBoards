import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { db, migrate, resetData, insertUser } from "./db";
import { hashToken, resolveSession } from "../../server/utils/auth";

// The v0.41.0 migrations, run against data shaped the way v0.40.3 left it:
// plaintext session and reset tokens, an address shared by two accounts, and a
// local account still carrying an address an administrator changed. Existing
// sessions and reset links must keep working across the upgrade.

const NEW_MIGRATIONS = [
  "0033_hash_session_tokens",
  "0034_hash_password_reset_tokens",
  "0035_unique_user_email",
  "0036_local_account_id_is_user_id",
];

const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  await migrate();
});
beforeEach(async () => {
  await resetData();
});

/** Put the schema back as it was before the new migrations. */
async function rewindSchema() {
  await db().query(
    "DELETE FROM `migrations` WHERE `id` IN (?)",
    [NEW_MIGRATIONS],
  );
  await db().query(
    "ALTER TABLE `user` DROP INDEX `user_email`, ADD INDEX `user_email` (`email`)",
  );
}

/** Apply the pending migrations again, in a fresh copy of the module. */
async function runPendingMigrations() {
  vi.resetModules();
  const fresh = await import("../../app/lib/databaseSetup");
  try {
    await fresh.runMigrations();
  } finally {
    await fresh.setupDatabase().end();
  }
}

async function indexIsUnique(): Promise<boolean> {
  const [rows]: any = await db().execute(
    "SELECT `NON_UNIQUE` FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user' AND INDEX_NAME = 'user_email' LIMIT 1",
  );
  return rows.length === 1 && Number(rows[0].NON_UNIQUE) === 0;
}

describe("v0.41.0 security migrations (integration, real MySQL)", () => {
  it("leaves user.email unique after a normal run", async () => {
    expect(await indexIsUnique()).toBe(true);
    await insertUser("u1", { email: "anna@example.com" });
    await expect(insertUser("u2", { email: "ANNA@example.com" })).rejects.toMatchObject({
      code: "ER_DUP_ENTRY",
    });
  });

  it("upgrades v0.40.3 data without signing anybody out", async () => {
    await rewindSchema();
    try {
      // A live session and a reset link, both stored as plaintext UUIDs.
      await insertUser("u-live", { email: "live@example.com" });
      const sessionToken = uuidv4();
      await db().execute(
        "INSERT INTO `session` (`id`,`expiresAt`,`token`,`userId`) VALUES (?,?,?,?)",
        ["sess-live", new Date(Date.now() + DAY), sessionToken, "u-live"],
      );
      const resetToken = uuidv4();
      await db().execute(
        "INSERT INTO `verification` (`id`,`identifier`,`value`,`expiresAt`) VALUES (?,?,?,?)",
        [uuidv4(), "live@example.com", resetToken, new Date(Date.now() + DAY)],
      );

      // Two accounts sharing an address (case differs; the collation does not care).
      await insertUser("b-second", { email: "Shared@example.com" });
      await insertUser("a-first", { email: "shared@example.com" });

      // A local account whose address an administrator changed.
      await insertUser("u-moved", { email: "new@example.com" });
      await db().execute(
        "INSERT INTO `account` (`id`,`accountId`,`providerId`,`userId`,`password`) VALUES (?,?,?,?,?)",
        [uuidv4(), "old@example.com", "local", "u-moved", "x"],
      );
      // A single sign-on link is keyed by the provider's subject and stays as it is.
      await db().execute(
        "INSERT INTO `account` (`id`,`accountId`,`providerId`,`userId`) VALUES (?,?,?,?)",
        [uuidv4(), "subject-123", "sso", "u-moved"],
      );

      await runPendingMigrations();

      // The session is stored hashed, and the browser's token still works.
      const [sessions]: any = await db().execute("SELECT `token` FROM `session` WHERE `id` = 'sess-live'");
      expect(sessions[0].token).toBe(hashToken(sessionToken));
      const resolved = await resolveSession({ headers: new Headers({ authorization: `Bearer ${sessionToken}` }) });
      expect(resolved.status).toBe("ok");

      // So is the reset link.
      const [resets]: any = await db().execute("SELECT `value` FROM `verification`");
      expect(resets.map((r: any) => r.value)).toEqual([hashToken(resetToken)]);

      // The lowest id keeps the shared address; the other is renamed, not deleted.
      const [shared]: any = await db().execute(
        "SELECT `id`, `email` FROM `user` WHERE `id` IN ('a-first', 'b-second') ORDER BY `id`",
      );
      expect(shared).toEqual([
        { id: "a-first", email: "shared@example.com" },
        { id: "b-second", email: "duplicate+b-second@lokalboards.invalid" },
      ]);
      expect(await indexIsUnique()).toBe(true);

      // The local account is keyed by the user; the SSO link is untouched.
      const [accounts]: any = await db().execute(
        "SELECT `providerId`, `accountId` FROM `account` WHERE `userId` = 'u-moved' ORDER BY `providerId`",
      );
      expect(accounts).toEqual([
        { providerId: "local", accountId: "u-moved" },
        { providerId: "sso", accountId: "subject-123" },
      ]);

      // The old address is free again: a new local account for it no longer collides.
      await insertUser("u-newcomer", { email: "old@example.com" });
      await db().execute(
        "INSERT INTO `account` (`id`,`accountId`,`providerId`,`userId`,`password`) VALUES (?,?,?,?,?)",
        [uuidv4(), "u-newcomer", "local", "u-newcomer", "x"],
      );
    } finally {
      // Whatever happened, leave the schema migrated for the other files.
      const [rows]: any = await db().query("SELECT `id` FROM `migrations` WHERE `id` IN (?)", [NEW_MIGRATIONS]);
      if (rows.length < NEW_MIGRATIONS.length) {
        await resetData();
        await runPendingMigrations();
      }
    }
  });

  it("is safe to run twice", async () => {
    await insertUser("u1");
    const token = uuidv4();
    await db().execute(
      "INSERT INTO `session` (`id`,`expiresAt`,`token`,`userId`) VALUES (?,?,?,?)",
      ["sess-1", new Date(Date.now() + DAY), hashToken(token), "u1"],
    );
    // Recorded as not applied, but the schema is already migrated (a crash
    // between the work and the record).
    await db().query("DELETE FROM `migrations` WHERE `id` IN (?)", [NEW_MIGRATIONS]);
    await runPendingMigrations();
    const [sessions]: any = await db().execute("SELECT `token` FROM `session`");
    expect(sessions[0].token).toBe(hashToken(token)); // not hashed twice
    expect(await indexIsUnique()).toBe(true);
  });
});
