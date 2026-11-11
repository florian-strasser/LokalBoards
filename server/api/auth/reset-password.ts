import { enforceRateLimit, passwordResetLimiter } from "../../utils/rateLimit";
import { hashToken } from "../../utils/auth";
import {
  dummyPasswordCheck,
  isPasswordLongEnough,
  setLocalPassword,
} from "../../utils/password";

// The links request-password.ts sends carry a UUID v4.
const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default authHandler("POST", "anyone", async ({ event, db }) => {
  // Throttle reset-token submissions per client IP (limits token brute-forcing).
  if (!enforceRateLimit(event, passwordResetLimiter)) {
    return { error: "TOO_MANY_REQUESTS" };
  }

  const { token, newPassword } = await readBody(event);

  if (!token || typeof token !== "string" || !uuidRegex.test(token)) {
    fail(400, "INVALID_TOKEN");
  }
  if (!isPasswordLongEnough(newPassword)) fail(400, "INVALID_PASSWORD");

  // Only the token's hash is stored (see request-password.ts).
  const tokenHash = hashToken(token);
  const [tokens] = await db.execute(
    "SELECT * FROM `verification` WHERE `value` = ? AND `expiresAt` > NOW()",
    [tokenHash],
  );
  if (tokens.length === 0) {
    // The same cost as hashing the new password below, so a guess learns
    // nothing from the timing.
    await dummyPasswordCheck(newPassword);
    fail(400, "INVALID_TOKEN");
  }

  // The account the link was sent for, which may have gone since; that costs
  // the same as well.
  const [users] = await db.execute("SELECT * FROM `user` WHERE `email` = ?", [
    tokens[0].identifier,
  ]);
  if (users.length === 0) {
    await dummyPasswordCheck(newPassword);
    fail(404, "INVALID_TOKEN");
  }
  const user = users[0];

  // The password of the account's own, local sign-in. An account that signs in
  // through SSO only has none and gets none from a link: the provider stays
  // the only way in (and no link is sent to one, see request-password.ts).
  if (!(await setLocalPassword(db, user.id, newPassword))) {
    fail(400, "INVALID_TOKEN");
  }

  // The link is good once.
  await db.execute("DELETE FROM `verification` WHERE `value` = ?", [tokenHash]);

  // Every session ends, so the new password is needed to get back in.
  await db.execute("DELETE FROM `session` WHERE `userId` = ?", [user.id]);

  return {
    success: true,
    message: "PASSWORD_RESET_SUCCESSFUL",
  };
});
