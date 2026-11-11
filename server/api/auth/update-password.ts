import { hashToken, sessionTokenOf } from "../../utils/auth";
import {
  dummyPasswordCheck,
  hashPassword,
  isPasswordLongEnough,
} from "../../utils/password";
import bcrypt from "bcryptjs";

export default authHandler("POST", "user", async ({ event, db, session }) => {
  const { oldPassword, newPassword, revokeOtherSessions = true } =
    await readBody(event);

  if (!oldPassword || !newPassword) fail(400, "BOTH_PASSWORDS_REQUIRED");
  if (oldPassword === newPassword) fail(400, "OLD_NEW_SAME");
  if (!isPasswordLongEnough(newPassword)) fail(400, "PASSWORD_TOO_SHORT");

  const [accounts] = await db.execute(
    "SELECT * FROM `account` WHERE `userId` = ? AND `providerId` = ?",
    [session.user.id, "local"],
  );
  if (accounts.length === 0) {
    // The same cost as checking the old password below.
    await dummyPasswordCheck(oldPassword);
    fail(404, "LOCAL_ACCOUNT_NOT_FOUND");
  }
  const account = accounts[0];

  if (!(await bcrypt.compare(oldPassword, account.password))) {
    fail(401, "INVALID_OLD_PASSWORD");
  }

  await db.execute(
    "UPDATE `account` SET `password` = ?, `updatedAt` = CURRENT_TIMESTAMP(3) WHERE `id` = ?",
    [await hashPassword(newPassword), account.id],
  );

  // Every other session ends unless asked otherwise: whoever knew the old
  // password may be holding one. This one, which made the change, stays.
  const currentSessionToken = sessionTokenOf(event);
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
});
