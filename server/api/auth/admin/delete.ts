import { setupDatabase } from "../../../../app/lib/databaseSetup";
import { getUserSession } from "../../../utils/auth";
import { sendEmail } from "../../../../app/lib/sendEmail";
import { getAccountDeletedEmail } from "../../../utils/translations";
import bcrypt from "bcryptjs";

const runtimeConfig = useRuntimeConfig();
const appName = runtimeConfig.appName;
const defaultLanguage = runtimeConfig.language;

export default defineEventHandler(async (event) => {
  const method = event.req.method;
  if (method !== "POST") {
    event.res.statusCode = 405;
    return { error: "Method not allowed" };
  }

  try {
    // Verify session and admin role
    const session = await getUserSession(event);
    if (!session) {
      event.res.statusCode = 401;
      return { error: "UNAUTHORIZED" };
    }

    if (session.user.role !== "admin") {
      event.res.statusCode = 403;
      return { error: "FORBIDDEN" };
    }

    const body = await readBody(event);
    const { userId, reason } = body;

    // Validate input - UUID format
    if (!isStoredId(userId)) {
      event.res.statusCode = 400;
      return { error: "INVALID_USER_ID" };
    }

    // A reason is required — the deleted user is emailed why their account was
    // removed, so a silent deletion doesn't leave them in the dark.
    if (
      !reason ||
      typeof reason !== "string" ||
      reason.trim() === "" ||
      reason.length > 2000
    ) {
      event.res.statusCode = 400;
      return { error: "INVALID_REASON" };
    }

    // Prevent admin from deleting themselves
    if (userId === session.user.id) {
      event.res.statusCode = 400;
      return { error: "DELETE_FORBIDDEN" };
    }

    const db = await setupDatabase();

    // Captured before deletion so we can email the user afterwards.
    let deletedUser: { email: string; name: string } | null = null;

    // Use transaction for atomic deletion across all tables
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      // HIGH FIX: Use constant-time check for user existence
      const [users] = await conn.execute(
        "SELECT id, email, name FROM `user` WHERE `id` = ?",
        [userId],
      );

      const userExists = users.length > 0;

      // Always perform fake hash comparison to maintain constant time
      const fakeHash = "$2a$10$fakehashforconstanttimecomparison";
      await bcrypt.compare(userId, fakeHash);

      if (!userExists) {
        await conn.rollback();
        event.res.statusCode = 404;
        return { error: "USER_NOT_FOUND" };
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
  } catch (error) {
    logger.error("Delete user error:", error);
    event.res.statusCode = 500;
    return { error: "INTERNAL_SERVER_ERROR" };
  }
});
