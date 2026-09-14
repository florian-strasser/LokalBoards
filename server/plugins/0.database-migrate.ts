import { runMigrations } from "../../app/lib/databaseSetup";
import { startupFailed, startupStepDone } from "../utils/startup";

// Run database migrations once at server startup.
//
// Nitro does not wait for an async plugin before it starts listening, so
// requests can arrive while this is still running. /api/health answers 503
// until it has finished (see server/utils/startup.ts), which is what anything
// deciding whether to send traffic here should be watching.
export default defineNitroPlugin(async () => {
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
