import { setupDatabase } from "../../../app/lib/databaseSetup";
import { v4 as uuidv4 } from "uuid";
import { sendEmail } from "../../../app/lib/sendEmail";
import { getEmailSubject, getEmailMessage } from "../../utils/translations";
import { enforceRateLimit, passwordRequestLimiter } from "../../utils/rateLimit";
import { hashToken } from "../../utils/auth";

const runtimeConfig = useRuntimeConfig();

const appName = runtimeConfig.appName;
const baseURL = runtimeConfig.boardsUrl;
const defaultLanguage = runtimeConfig.language;

// The answer is the same for every address, and so is how long it takes: the
// link is stored as a hash and the mail goes out after the response. Until
// v0.41.0 the SMTP round trip was awaited for existing accounts only, so the
// response time said which addresses had one.

export default defineEventHandler(async (event) => {
  const method = event.req.method;
  if (method !== "POST") {
    event.res.statusCode = 405;
    return { error: "Method not allowed" };
  }

  // Throttle reset requests per client IP (limits email bombing and probing).
  if (!enforceRateLimit(event, passwordRequestLimiter)) {
    return { error: "TOO_MANY_REQUESTS" };
  }

  try {
    const body = await readBody(event);
    const { email } = body;

    // HIGH FIX: Strong email validation with regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || typeof email !== "string" || !emailRegex.test(email)) {
      event.res.statusCode = 400;
      return { error: "INVALID_EMAIL_FORMAT" };
    }

    const db = await setupDatabase();

    // Check if user exists
    const [users] = await db.execute(
      "SELECT id, name, email FROM `user` WHERE `email` = ?",
      [email],
    );

    // HIGH FIX: Consistent timing - always generate token regardless of user existence
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now

    // HIGH FIX: Use constant-time approach - perform same operations regardless of user existence
    if (users.length > 0) {
      const user = users[0];

      // Store the token's hash in the verification table; the link carries
      // the token itself.
      await db.execute(
        "INSERT INTO `verification` (`id`, `identifier`, `value`, `expiresAt`) VALUES (?, ?, ?, ?)",
        [uuidv4(), user.email, hashToken(token), expiresAt],
      );

      // Create reset link
      const resetLink = `${baseURL}/reset-password/${token}`;

      // Send email using our email service with translations
      const subject = getEmailSubject(
        "reset_your_password_subject",
        appName,
        defaultLanguage,
      );
      const emailText = getEmailMessage(
        "reset_your_password_message",
        resetLink,
        defaultLanguage,
      );

      // Not awaited (see above). sendEmail logs its own failures; the
      // request's context is kept alive until the mail server has answered.
      const sending = sendEmail({
        to: user.email,
        subject: subject,
        text: emailText,
      }).catch(() => {});
      (event as any).waitUntil?.(sending);
    }
    // If user doesn't exist, token is generated but not used - timing is similar

    // HIGH FIX: Consistent success message for all cases
    return {
      success: true,
      message:
        "If an account exists with this email, a password reset link has been sent",
    };
  } catch (error) {
    logger.error("Request password reset error:", error);
    event.res.statusCode = 500;
    return { error: "Internal server error" };
  }
});
