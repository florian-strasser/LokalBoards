import { createSession } from "../../../utils/auth";

// Start impersonating another user. An admin swaps their own session cookie for
// a fresh session that authenticates as the target user, tagged with the
// admin's id (`impersonatedBy`) so the app can show a banner and let them
// switch back via /api/auth/admin/stop-impersonate.
export default authHandler("POST", "admin", async ({ event, db, session }) => {
  // Refuse to nest impersonation — an already-impersonating session must stop
  // first, otherwise there's no reliable admin identity to return to.
  if (session.session?.impersonatedBy) fail(400, "ALREADY_IMPERSONATING");

  const { userId } = (await readBody(event)) || {};
  if (!isStoredId(userId)) fail(400, "INVALID_USER_ID");

  // Impersonating yourself is a no-op that would only complicate the "stop"
  // flow, so reject it.
  if (userId === session.user.id) fail(400, "CANNOT_IMPERSONATE_SELF");

  const [users]: any = await db.execute(
    "SELECT id, banned FROM `user` WHERE `id` = ?",
    [userId],
  );
  if (users.length === 0) fail(404, "USER_NOT_FOUND");
  // Banned users have no access; impersonating one would be a dead end.
  if (users[0].banned) fail(400, "USER_BANNED");

  // Issue a new session for the target user, recording who is behind it. This
  // sets the session cookie, replacing the admin's own session cookie.
  const result = await createSession(event, userId, session.user.id);
  if ("error" in result) fail(500, result.error);

  return { success: true };
});
