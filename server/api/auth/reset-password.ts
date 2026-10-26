import { setupDatabase } from "../../../app/lib/databaseSetup";
import { enforceRateLimit, passwordResetLimiter } from "../../utils/rateLimit";
import { hashToken } from "../../utils/auth";
import { dummyPasswordCheck } from "../../utils/password";
import bcrypt from "bcryptjs";

// UUID v4 regex pattern for token validation
const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default defineEventHandler(async (event) => {
  const method = event.req.method;
  if (method !== "POST") {
    event.res.statusCode = 405;
    return { error: "Method not allowed" };
  }

  // Throttle reset-token submissions per client IP (limits token brute-forcing).
  if (!enforceRateLimit(event, passwordResetLimiter)) {
    return { error: "TOO_MANY_REQUESTS" };
  }

  try {
    const body = await readBody(event);
    const { token, newPassword } = body;

    // HIGH FIX: Strong token and password validation with generic errors
    if (!token || typeof token !== "string" || !uuidRegex.test(token)) {
      event.res.statusCode = 400;
      return { error: "INVALID_TOKEN" };
    }

    if (
      !newPassword ||
      typeof newPassword !== "string" ||
      newPassword.length < 8
    ) {
      event.res.statusCode = 400;
      return { error: "INVALID_PASSWORD" };
    }

    const db = await setupDatabase();

    // Only the token's hash is stored (see request-password.ts).
    const tokenHash = hashToken(token);
    const [tokens] = await db.execute(
      "SELECT * FROM `verification` WHERE `value` = ? AND `expiresAt` > NOW()",
      [tokenHash],
    );

    const tokenExists = tokens.length > 0;

    if (!tokenExists) {
      // The same cost as hashing the new password below, so a guess learns
      // nothing from the timing.
      await dummyPasswordCheck(newPassword);
      event.res.statusCode = 400;
      return { error: "INVALID_TOKEN" };
    }

    const verificationToken = tokens[0];

    // CRITICAL FIX: Use constant-time check for user existence
    const [users] = await db.execute("SELECT * FROM `user` WHERE `email` = ?", [
      verificationToken.identifier,
    ]);

    const userExists = users.length > 0;

    if (!userExists) {
      await dummyPasswordCheck(newPassword);
      event.res.statusCode = 404;
      return { error: "INVALID_TOKEN" };
    }

    const user = users[0];

    // Hash the new password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update password in database
    await db.execute(
      "UPDATE `account` SET `password` = ?, `updatedAt` = CURRENT_TIMESTAMP(3) WHERE `userId` = ?",
      [hashedPassword, user.id],
    );

    // Delete the used token
    await db.execute("DELETE FROM `verification` WHERE `value` = ?", [
      tokenHash,
    ]);

    // Delete all user sessions to force login with new password
    await db.execute("DELETE FROM `session` WHERE `userId` = ?", [user.id]);

    return {
      success: true,
      message: "PASSWORD_RESET_SUCCESSFUL",
    };
  } catch (error) {
    logger.error("Reset password error:", error);
    event.res.statusCode = 500;
    return { error: "INTERNAL_SERVER_ERROR" };
  }
});
