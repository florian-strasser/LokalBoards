import { v4 as uuidv4 } from "uuid";
import { sendEmail } from "../../../app/lib/sendEmail";
import { getEmailSubject, getEmailMessage } from "../../utils/emails";
import { enforceRateLimit, passwordRequestLimiter } from "../../utils/rateLimit";
import { hashToken } from "../../utils/auth";
import { isEmail } from "../../utils/password";

const runtimeConfig = useRuntimeConfig();

const appName = runtimeConfig.appName;
const baseURL = runtimeConfig.boardsUrl;
const defaultLanguage = runtimeConfig.language;

// The answer is the same for every address, and so is how long it takes: the
// link is stored as a hash and the mail goes out after the response. Until
// v0.41.0 the SMTP round trip was awaited for existing accounts only, so the
// response time said which addresses had one.

export default authHandler("POST", "anyone", async ({ event, db }) => {
  // Throttle reset requests per client IP (limits email bombing and probing).
  if (!enforceRateLimit(event, passwordRequestLimiter)) {
    return { error: "TOO_MANY_REQUESTS" };
  }

  const { email } = await readBody(event);
  if (!isEmail(email)) fail(400, "INVALID_EMAIL_FORMAT");

  // Only an account with a password of its own can have it reset. One that
  // signs in through SSO only is sent nothing — the answer below is the same,
  // so it says nothing about which kind of account an address has.
  const [users] = await db.execute(
    "SELECT u.id, u.name, u.email FROM `user` u JOIN `account` a ON a.userId = u.id AND a.providerId = 'local' WHERE u.email = ?",
    [email],
  );

  const token = uuidv4();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now

  if (users.length > 0) {
    const user = users[0];

    // Store the token's hash in the verification table; the link carries
    // the token itself.
    await db.execute(
      "INSERT INTO `verification` (`id`, `identifier`, `value`, `expiresAt`) VALUES (?, ?, ?, ?)",
      [uuidv4(), user.email, hashToken(token), expiresAt],
    );

    const resetLink = `${baseURL}/reset-password/${token}`;
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

  return {
    success: true,
    message:
      "If an account exists with this email, a password reset link has been sent",
  };
});
