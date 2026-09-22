import { runMigrations } from "../../app/lib/databaseSetup";
import { startupFailed, startupStepDone } from "../utils/startup";

// Run database migrations once at server startup.
//
// Nitro does not wait for an async plugin before it starts listening, so
// requests can arrive while this is still running. /api/health answers 503
// until it has finished (see server/utils/startup.ts), which is what anything
// deciding whether to send traffic here should be watching.
//
// The dev server does not migrate a database that is not on this machine. A
// `.env` pointing at the live database is a common way to try something
// against real data, and a migration is not trying: a dev server started with
// an unreleased migration once dropped a column the live instance still read,
// and every board there stopped loading its cards. On the dev
// server a remote database is left as it is — say NUXT_DEV_MIGRATE=true to
// migrate it anyway — and a built instance migrates as it always has.
const LOCAL_HOSTS = new Set(["", "localhost", "127.0.0.1", "::1"]);

function devMayMigrate(host: unknown, allow: unknown): boolean {
  if (String(allow ?? "").trim().toLowerCase() === "true") return true;
  return LOCAL_HOSTS.has(String(host ?? "").trim().toLowerCase());
}

export default defineNitroPlugin(async () => {
  if (import.meta.dev) {
    const host = useRuntimeConfig().mysqlHost ?? process.env.NUXT_MYSQL_HOST;
    if (!devMayMigrate(host, process.env.NUXT_DEV_MIGRATE)) {
      logger.warn(
        "Dev server: the database is not on this machine, so migrations are not applied to it. Set NUXT_DEV_MIGRATE=true to apply them anyway.",
      );
      startupStepDone("migrations");
      return;
    }
  }
  try {
    await runMigrations();
    startupStepDone("migrations");
  } catch (err) {
    // Don't report healthy against a database with an unknown schema.
    startupFailed();
    logger.error("Database migration failed:", err);
    throw err;
  }
});
