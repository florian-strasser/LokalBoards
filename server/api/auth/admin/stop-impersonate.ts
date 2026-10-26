import { getCookie } from "h3";
import { setupDatabase } from "../../../../app/lib/databaseSetup";
import { getUserSession, createSession, hashToken } from "../../../utils/auth";

// End an impersonation session and return to the original admin account. The
// current session must be an impersonation session (its `impersonatedBy` names
// the admin); we drop it and mint a fresh admin session.
export default defineEventHandler(async (event) => {
  const method = event.req.method;
  if (method !== "POST") {
    event.res.statusCode = 405;
    return { error: "Method not allowed" };
  }

  try {
    const session = await getUserSession(event);
    if (!session) {
      event.res.statusCode = 401;
      return { error: "UNAUTHORIZED" };
    }

    const adminId = session.session?.impersonatedBy;
    if (!adminId) {
      event.res.statusCode = 400;
      return { error: "NOT_IMPERSONATING" };
    }

    const db = await setupDatabase();

    // The account we return to must still exist and still be an admin —
    // otherwise a demoted/deleted admin's impersonation could be used to regain
    // admin access.
    const [admins]: any = await db.execute(
      "SELECT id, role, banned FROM `user` WHERE `id` = ?",
      [adminId],
    );
    if (admins.length === 0 || admins[0].role !== "admin" || admins[0].banned) {
      event.res.statusCode = 403;
      return { error: "ADMIN_UNAVAILABLE" };
    }

    // Drop the impersonation session so its token can't be reused.
    const impersonationToken = getCookie(event, "session_token");
    if (impersonationToken) {
      await db.execute("DELETE FROM `session` WHERE `token` = ?", [
        hashToken(impersonationToken),
      ]);
    }

    // Mint a fresh session for the admin (not an impersonation), replacing the
    // cookie.
    const result = await createSession(event, adminId);
    if ("error" in result) {
      event.res.statusCode = 500;
      return { error: result.error };
    }

    return { success: true };
  } catch (error) {
    logger.error("Stop impersonate error:", error);
    event.res.statusCode = 500;
    return { error: "INTERNAL_SERVER_ERROR" };
  }
});
