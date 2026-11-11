import { sendEmail } from "../../../../app/lib/sendEmail";
import { getWelcomeAdminEmail } from "../../../utils/emails";
import {
  createLocalUser,
  dummyPasswordCheck,
  isEmail,
  isPasswordLongEnough,
} from "../../../utils/password";

const runtimeConfig = useRuntimeConfig();
const appName = runtimeConfig.appName;
const loginURL = runtimeConfig.boardsUrl;
const defaultLanguage = runtimeConfig.language;

export default authHandler("POST", "admin", async ({ event, db, session }) => {
  const {
    name,
    email,
    password,
    role = "user",
    type = "human",
    sendEmail: sendMail,
    onboarding = false,
  } = await readBody(event);

  // "artificial" marks a non-human account (an AI agent). Only admins can
  // create one — public signup never sets this, so it defaults to human.
  if (type !== "human" && type !== "artificial") fail(400, "INVALID_TYPE");

  // Every field has a length limit, so nobody stores a novel as a name.
  if (!name || !email || !password) fail(400, "REQUIRED_FIELDS_MISSING");
  if (typeof name !== "string" || name.trim() === "" || name.length > 255) {
    fail(400, "INVALID_NAME");
  }
  if (!isEmail(email) || email.length > 255) fail(400, "INVALID_EMAIL");
  if (!isPasswordLongEnough(password) || password.length > 255) {
    fail(400, "INVALID_PASSWORD");
  }
  if (role !== "user" && role !== "admin") fail(400, "INVALID_ROLE");

  const [existingUsers] = await db.execute(
    "SELECT * FROM `user` WHERE `email` = ?",
    [email],
  );
  if (existingUsers.length > 0) {
    // The same cost as hashing the password below.
    await dummyPasswordCheck(password);
    fail(400, "EMAIL_ALREADY_EXISTS");
  }

  let userId: string;
  try {
    // `onboarded` is set from the admin's choice: opt-in to the first-run tour
    // (0) or skip it (1, the default). Bots don't read email, so artificial
    // accounts start with notification mails switched off (still changeable
    // later).
    userId = await createLocalUser(
      db,
      {
        name: name.trim(),
        email,
        emailVerified: 1,
        role,
        onboarded: onboarding ? 0 : 1,
        type,
        emailNotifications: type === "artificial" ? 0 : 1,
      },
      password,
    );
  } catch (error: any) {
    // The address was taken between the check above and the insert.
    if (error?.code === "ER_DUP_ENTRY") fail(400, "EMAIL_ALREADY_EXISTS");
    throw error;
  }

  // Optionally email the new user their credentials instead of the admin
  // copying them by hand. Best-effort: if delivery fails the account still
  // exists, so we report emailSent:false and the admin falls back to copying.
  let emailSent = false;
  if (sendMail) {
    try {
      const { subject, html } = getWelcomeAdminEmail({
        appName,
        name: name.trim(),
        adminName: session.user.name,
        email,
        password,
        loginURL,
        language: defaultLanguage,
      });
      await sendEmail({ to: email, subject, text: html });
      emailSent = true;
    } catch (mailError) {
      logger.error("Welcome email (admin) failed:", mailError);
    }
  }

  return {
    success: true,
    message: "USER_CREATED_SUCCESSFULLY",
    emailSent,
    user: {
      id: userId,
      name: name.trim(),
      email: email,
      role: role,
    },
  };
});
