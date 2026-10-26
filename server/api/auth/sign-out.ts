import { setupDatabase } from "../../../app/lib/databaseSetup";
import { deleteCookie, getCookie } from "h3";
import { hashToken } from "../../utils/auth";

export default defineEventHandler(async (event) => {
  const method = event.req.method;
  if (method !== "POST") {
    event.res.statusCode = 405;
    return { error: "Method not allowed" };
  }

  try {
    // Extract session token from headers or cookies
    const sessionToken =
      event.headers.get("authorization")?.replace("Bearer ", "") ||
      getCookie(event, "session_token");

    // MEDIUM FIX: Validate session token format (non-empty, reasonable length)
    if (
      !sessionToken ||
      typeof sessionToken !== "string" ||
      sessionToken.length < 10
    ) {
      event.res.statusCode = 400;
      return { error: "Logout failed" };
    }

    const db = await setupDatabase();

    // Delete the session from database (stored by its hash)
    const [result] = await db.execute(
      "DELETE FROM `session` WHERE `token` = ?",
      [hashToken(sessionToken)],
    );

    // LOW FIX: Only return success if a session was actually deleted
    if (result.affectedRows === 0) {
      event.res.statusCode = 400;
      return { error: "Logout failed" };
    }

    // Delete the session cookie
    deleteCookie(event, "session_token", {
      path: "/",
    });

    return {
      success: true,
      message: "Successfully logged out",
    };
  } catch (error) {
    logger.error("Logout error:", error);
    event.res.statusCode = 500;
    return { error: "Internal server error" };
  }
});
