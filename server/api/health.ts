import { defineEventHandler } from "h3";
import { setupDatabase } from "../../app/lib/databaseSetup";
import { startupState } from "../utils/startup";

// Public health/readiness endpoint for Docker, compose, and orchestrators.
// Verifies the app has finished starting — migrations applied, first
// administrator in place — AND can reach its database. Returns 200 when
// healthy, 503 while starting, when startup failed, or when the database is
// unreachable. Deliberately leaks no details.
export default defineEventHandler(async (event) => {
  if (event.req.method !== "GET") {
    event.res.statusCode = 405;
    return { error: "Method not allowed" };
  }

  const state = startupState();
  if (state !== "ready") {
    event.res.statusCode = 503;
    return state === "starting" ? { status: "starting" } : { status: "error" };
  }

  try {
    await setupDatabase().query("SELECT 1");
    return { status: "ok", database: "ok" };
  } catch (error) {
    logger.error("Health check failed:", error);
    event.res.statusCode = 503;
    return { status: "error", database: "unreachable" };
  }
});
