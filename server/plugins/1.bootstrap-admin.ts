import type { RowDataPacket } from "mysql2";
import { runMigrations, setupDatabase } from "../../app/lib/databaseSetup";
import {
  createLocalUser,
  isEmail,
  isPasswordLongEnough,
} from "../utils/password";
import { startupStepDone } from "../utils/startup";

// Seed the first administrator from the environment.
//
// A fresh instance has a chicken-and-egg problem: the admin screens are the only
// place to promote an account, and reaching them needs an admin. Until now the
// answer was to sign up and then edit the `role` column in MySQL by hand, which
// is a poor first impression and a worse instruction to leave in the
// documentation. NUXT_ADMIN_EMAIL / NUXT_ADMIN_PASSWORD do it declaratively at
// boot instead, which is also what a container or a managed host wants.
//
// The rules that make it safe to leave configured permanently:
//
//   * It only ever acts when the instance has **no administrator at all**. Once
//     one exists this is a no-op, so a role changed in the interface is never
//     silently reapplied from a stale environment variable.
//   * It never touches an existing account's password. An address that already
//     has an account is promoted in place, and its owner keeps the password
//     they know.
//   * Failures are logged, not thrown. A typo in an address should not stop a
//     running service; boards stay reachable and the operator gets a clear line
//     in the log.
//   * Nothing secret is ever written to the log — not the password, not a hash,
//     not a "generated password" line. The address is the most it will say.
//
// It doubles as a recovery hatch: if the last administrator is ever deleted,
// restarting with these set restores access.
//
// The `1.` prefix does NOT guarantee this runs after `0.database-migrate.ts` —
// measured on a fresh database, this plugin reached the `user` table 73ms before
// the migrations created it. So it waits for the schema itself. `runMigrations`
// memoises its promise, so this awaits the same run rather than starting a
// second one.
export default defineNitroPlugin(async () => {
  const config = useRuntimeConfig();

  const email = String(config.adminEmail || "")
    .trim()
    .toLowerCase();
  const password = String(config.adminPassword || "");
  const name =
    String(config.adminName || "").trim() || "Administrator";

  // Not configured is the normal case for an instance set up through the
  // sign-up form; say nothing at all.
  if (!email && !password) {
    startupStepDone("admin");
    return;
  }

  try {
    await runMigrations();

    const db = setupDatabase();

    const [admins] = await db.execute<RowDataPacket[]>(
      "SELECT `id` FROM `user` WHERE `role` = 'admin' LIMIT 1",
    );

    if (admins.length > 0) {
      logger.debug("Admin bootstrap skipped: an administrator already exists");
      return;
    }

    if (!isEmail(email)) {
      logger.error(
        "Admin bootstrap failed: NUXT_ADMIN_EMAIL is not a valid e-mail address",
      );
      return;
    }

    const [existing] = await db.execute<RowDataPacket[]>(
      "SELECT `id` FROM `user` WHERE `email` = ?",
      [email],
    );

    if (existing[0]) {
      // Promote in place, password untouched: this account already has one its
      // owner knows, and the environment should not overwrite it behind their
      // back.
      await db.execute(
        "UPDATE `user` SET `role` = 'admin', `updatedAt` = CURRENT_TIMESTAMP(3) WHERE `id` = ?",
        [existing[0].id],
      );
      logger.info(
        `Admin bootstrap: promoted the existing account ${email} to administrator (password unchanged)`,
      );
      return;
    }

    // Creating an account does need a password, held to the same minimum the
    // sign-up form enforces.
    if (!isPasswordLongEnough(password)) {
      logger.error(
        "Admin bootstrap failed: NUXT_ADMIN_PASSWORD must be at least 8 characters",
      );
      return;
    }

    await createLocalUser(
      db,
      { name, email, emailVerified: 1, role: "admin", onboarded: 0 },
      password,
    );

    logger.info(`Admin bootstrap: created the first administrator ${email}`);
    logger.warn(
      "Change this password after signing in. NUXT_ADMIN_PASSWORD can then be " +
        "removed from the environment — it is only read when no administrator exists.",
    );
  } catch (error) {
    logger.error("Admin bootstrap failed", error);
  } finally {
    // Done either way: a failure is logged and the instance still serves, as
    // it always has. /api/health waits for this so that "healthy" means the
    // administrator it was told to create can sign in.
    startupStepDone("admin");
  }
});
