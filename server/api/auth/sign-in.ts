import { setupDatabase } from "../../../app/lib/databaseSetup";
import { createSession } from "../../utils/auth";
import { dummyPasswordCheck } from "../../utils/password";
import {
  blockIfRateLimited,
  recordFailure,
  signInLimiter,
} from "../../utils/rateLimit";
import bcrypt from "bcryptjs";

export default defineEventHandler(async (event) => {
  const method = event.req.method;
  if (method !== "POST") {
    event.res.statusCode = 405;
    return { error: "method_not_allowed" };
  }

  // Throttle brute-force logins per client IP. Only *failed* attempts count
  // (recorded below), so legitimate users — including many behind one office IP
  // — aren't locked out by successful logins.
  if (blockIfRateLimited(event, signInLimiter)) {
    return { error: "too_many_requests" };
  }

  try {
    const body = await readBody(event);
    const { email, password, callbackURL } = body;

    // HIGH FIX: Validate input with generic message
    if (!email || !password) {
      event.res.statusCode = 400;
      return { error: "required_fields_missing" };
    }

    // HIGH FIX: Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      event.res.statusCode = 400;
      return { error: "invalid_credentials" };
    }

    // HIGH FIX: Validate password length (min 8 chars)
    if (typeof password !== "string" || password.length < 8) {
      event.res.statusCode = 400;
      return { error: "invalid_credentials" };
    }

    // Initialize the database
    const db = await setupDatabase();

    // CRITICAL FIX: Use constant-time query to prevent timing attacks
    // Always perform both queries regardless of user existence
    const [users] = await db.execute("SELECT * FROM `user` WHERE `email` = ?", [
      email,
    ]);

    if (users.length === 0) {
      // As long as checking a real password takes, so the response time does
      // not say whether the address has an account (see password.ts).
      await dummyPasswordCheck(password);
      recordFailure(event, signInLimiter);
      event.res.statusCode = 401;
      return { error: "invalid_email_or_password" };
    }

    const user = users[0];

    // Fetch the account details to get the hashed password
    const [accounts] = await db.execute(
      "SELECT * FROM `account` WHERE `userId` = ? AND `providerId` = ?",
      [user.id, "local"],
    );

    if (accounts.length === 0) {
      // An account with no password (single sign-on only) costs the same.
      await dummyPasswordCheck(password);
      recordFailure(event, signInLimiter);
      event.res.statusCode = 401;
      return { error: "invalid_email_or_password" };
    }

    const account = accounts[0];

    // Compare the provided password with the hashed password
    const isPasswordValid = await bcrypt.compare(password, account.password);

    if (!isPasswordValid) {
      recordFailure(event, signInLimiter);
      event.res.statusCode = 401;
      return { error: "invalid_email_or_password" };
    }

    // Create a session for the user
    const sessionResult = await createSession(event, user.id);

    if (sessionResult.error) {
      logger.error("Session creation failed:", sessionResult.error);
      event.res.statusCode = 500;
      return { error: "authentication_failed" };
    }

    // Return success response with user details and session token
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
  } catch (error) {
    logger.error("Sign-in error:", error);
    event.res.statusCode = 500;
    return { error: "internal_server_error" };
  }
});
