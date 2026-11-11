import { createSession } from "../../utils/auth";
import {
  dummyPasswordCheck,
  isEmail,
  isPasswordLongEnough,
} from "../../utils/password";
import {
  blockIfRateLimited,
  recordFailure,
  signInLimiter,
} from "../../utils/rateLimit";
import bcrypt from "bcryptjs";

export default authHandler("POST", "anyone", async ({ event, db }) => {
  // Throttle brute-force logins per client IP. Only *failed* attempts count
  // (recorded below), so legitimate users — including many behind one office IP
  // — aren't locked out by successful logins.
  if (blockIfRateLimited(event, signInLimiter)) {
    return { error: "too_many_requests" };
  }

  const { email, password, callbackURL } = await readBody(event);

  if (!email || !password) fail(400, "required_fields_missing");
  // An address that is not one, or a password shorter than any account can
  // have, cannot sign in; the answer does not say which of the two it was.
  if (!isEmail(email) || !isPasswordLongEnough(password)) {
    fail(400, "invalid_credentials");
  }

  // Every wrong answer counts towards the limit and reads the same.
  function refuse(): never {
    recordFailure(event, signInLimiter);
    return fail(401, "invalid_email_or_password");
  }

  // The address first, then its password. The two ways of having no password
  // to check — no such account, or one that signs in through SSO only — each
  // spend the time a check takes, so the response time does not say whether
  // the address has an account (see password.ts).
  const [users] = await db.execute("SELECT * FROM `user` WHERE `email` = ?", [
    email,
  ]);
  if (users.length === 0) {
    await dummyPasswordCheck(password);
    refuse();
  }
  const user = users[0];

  const [accounts] = await db.execute(
    "SELECT * FROM `account` WHERE `userId` = ? AND `providerId` = ?",
    [user.id, "local"],
  );
  if (accounts.length === 0) {
    await dummyPasswordCheck(password);
    refuse();
  }

  if (!(await bcrypt.compare(password, accounts[0].password))) refuse();

  const sessionResult = await createSession(event, user.id);
  if (sessionResult.error) {
    logger.error("Session creation failed:", sessionResult.error);
    fail(500, "authentication_failed");
  }

  return {
    data: {
      success: true,
      message: "User signed in successfully",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      sessionToken: sessionResult.sessionToken,
      callbackURL,
    },
  };
});
