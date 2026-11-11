import { dummyPasswordCheck } from "../../../utils/password";
import { sendEmail } from "../../../../app/lib/sendEmail";
import { getAccountDeletedEmail } from "../../../utils/emails";

const runtimeConfig = useRuntimeConfig();
const appName = runtimeConfig.appName;
const defaultLanguage = runtimeConfig.language;

export default authHandler("POST", "admin", async ({ event, db, session }) => {
  const { userId, reason } = await readBody(event);

  if (!isStoredId(userId)) fail(400, "INVALID_USER_ID");

  // A reason is required — the deleted user is emailed why their account was
  // removed, so a silent deletion doesn't leave them in the dark.
  if (
    !reason ||
    typeof reason !== "string" ||
    reason.trim() === "" ||
    reason.length > 2000
  ) {
    fail(400, "INVALID_REASON");
  }

  // An admin cannot delete themselves.
  if (userId === session.user.id) fail(400, "DELETE_FORBIDDEN");

  // Captured before deletion so we can email the user afterwards.
  let deletedUser: { email: string; name: string } | null = null;

  // One transaction for every table the account is in.
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [users] = await conn.execute(
      "SELECT id, email, name FROM `user` WHERE `id` = ?",
      [userId],
    );
    if (users.length === 0) {
      await dummyPasswordCheck(userId);
      fail(404, "USER_NOT_FOUND");
    }

    deletedUser = { email: users[0].email, name: users[0].name };

    // Delete user's sessions first
    await conn.execute("DELETE FROM `session` WHERE `userId` = ?", [userId]);

    // Delete user's account
    await conn.execute("DELETE FROM `account` WHERE `userId` = ?", [userId]);

    // Delete user's API keys
    await conn.execute("DELETE FROM `apikey` WHERE `referenceId` = ?", [
      userId,
    ]);

    // The rows that pointed at them from other people's boards. An invitation
    // left behind names an account that is no longer there, and every board
    // it belongs to then renders a member with no name — which used to take
    // the whole page down with a 500. Their notifications and any e-mail
    // invitations they sent go the same way: nobody can act on either.
    await conn.execute("DELETE FROM `invitations` WHERE `user` = ?", [userId]);
    // And the cards they were on: an assignment to nobody is a face on the
    // tile that belongs to no one.
    await conn.execute("DELETE FROM `card_assignees` WHERE `user` = ?", [
      userId,
    ]);
    await conn.execute(
      "DELETE FROM `notifications` WHERE `userId` = ? OR `actorId` = ?",
      [userId, userId],
    );
    await conn.execute(
      "DELETE FROM `board_email_invites` WHERE `invitedBy` = ? AND `usedAt` IS NULL",
      [userId],
    );

    // Finally, delete the user
    await conn.execute("DELETE FROM `user` WHERE `id` = ?", [userId]);

    await conn.commit();
  } catch (error) {
    // Including the 404 above, which leaves the same way.
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }

  // Notify the deleted user by email with the reason. Best-effort: the
  // account is already gone, so a mail failure just gets logged.
  if (deletedUser) {
    try {
      const { subject, html } = getAccountDeletedEmail({
        appName,
        name: deletedUser.name,
        reason: reason.trim(),
        language: defaultLanguage,
      });
      await sendEmail({ to: deletedUser.email, subject, text: html });
    } catch (mailError) {
      logger.error("Account-deleted email failed:", mailError);
    }
  }

  return {
    success: true,
    message: "USER_DELETED_SUCCESSFULLY",
  };
});
