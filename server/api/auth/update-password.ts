import { setupDatabase } from "../../../app/lib/databaseSetup";
import { getUserSession, hashToken } from "../../utils/auth";
import { dummyPasswordCheck } from "../../utils/password";
import { getCookie } from "h3";
import bcrypt from "bcryptjs";

export default defineEventHandler(async (event) => {
  const method = event.req.method;
  if (method !== "POST") {
    event.res.statusCode = 405;
    return { error: "Method not allowed" };
  }

  try {
    // Get current session token from request for later use
    const currentSessionToken =
      event.headers.get("authorization")?.replace("Bearer ", "") ||
      getCookie(event, "session_token");

    // Verify session first
    const session = await getUserSession(event);
    if (!session) {
      event.res.statusCode = 401;
      return { error: "UNAUTHORIZED" };
    }

    const body = await readBody(event);
    const { oldPassword, newPassword, revokeOtherSessions = true } = body;

    // Validate input
    if (!oldPassword || !newPassword) {
      event.res.statusCode = 400;
      return { error: "BOTH_PASSWORDS_REQUIRED" };
    }

    // MEDIUM FIX: Check old != new password
    if (oldPassword === newPassword) {
      event.res.statusCode = 400;
      return { error: "OLD_NEW_SAME" };
    }

    if (newPassword.length < 8) {
      event.res.statusCode = 400;
      return { error: "PASSWORD_TOO_SHORT" };
    }

    const db = await setupDatabase();

    // CRITICAL FIX: Use constant-time check for account existence
    const [accounts] = await db.execute(
      "SELECT * FROM `account` WHERE `userId` = ? AND `providerId` = ?",
      [session.user.id, "local"],
    );

    const accountExists = accounts.length > 0;

    if (!accountExists) {
      // The same cost as checking the old password below.
      await dummyPasswordCheck(oldPassword);
      event.res.statusCode = 404;
      return { error: "LOCAL_ACCOUNT_NOT_FOUND" };
    }

    const account = accounts[0];

    // Verify old password
    const isPasswordValid = await bcrypt.compare(oldPassword, account.password);
    if (!isPasswordValid) {
      event.res.statusCode = 401;
      return { error: "INVALID_OLD_PASSWORD" };
    }

    // Hash the new password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update password in database
    await db.execute(
      "UPDATE `account` SET `password` = ?, `updatedAt` = CURRENT_TIMESTAMP(3) WHERE `id` = ?",
      [hashedPassword, account.id],
    );

    // Revoke other sessions if requested
    if (revokeOtherSessions && currentSessionToken) {
      await db.execute(
        "DELETE FROM `session` WHERE `userId` = ? AND `token` != ?",
        [session.user.id, hashToken(currentSessionToken)],
      );
    }

    return {
      success: true,
      message: "PASSWORD_UPDATED_SUCCESSFULLY",
      sessionsRevoked: revokeOtherSessions,
    };
  } catch (error) {
    logger.error("Update password error:", error);
    event.res.statusCode = 500;
    return { error: "Internal server error" };
  }
});
