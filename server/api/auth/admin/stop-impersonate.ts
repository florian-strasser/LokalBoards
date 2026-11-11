import { createSession } from "../../../utils/auth";

// End an impersonation session and return to the original admin account. The
// current session must be an impersonation session (its `impersonatedBy` names
// the admin); we drop it and mint a fresh admin session.
export default authHandler("POST", "user", async ({ event, db, session }) => {
  const adminId = session.session?.impersonatedBy;
  if (!adminId) fail(400, "NOT_IMPERSONATING");

  // The account we return to must still exist and still be an admin —
  // otherwise a demoted/deleted admin's impersonation could be used to regain
  // admin access.
  const [admins]: any = await db.execute(
    "SELECT id, role, banned FROM `user` WHERE `id` = ?",
    [adminId],
  );
  if (admins.length === 0 || admins[0].role !== "admin" || admins[0].banned) {
    fail(403, "ADMIN_UNAVAILABLE");
  }

  // Drop the impersonation session so its token can't be reused — the very
  // session checked above, by its id. It may have come as a bearer token
  // rather than the cookie, and deleting whatever the cookie named would then
  // leave the impersonation alive and end some other session instead.
  await db.execute("DELETE FROM `session` WHERE `id` = ?", [session.session.id]);

  // Mint a fresh session for the admin (not an impersonation), replacing the
  // cookie.
  const result = await createSession(event, adminId);
  if ("error" in result) fail(500, result.error);

  return { success: true };
});
