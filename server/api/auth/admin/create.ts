import { setupDatabase } from "../../../../app/lib/databaseSetup";
import { getUserSession } from "../../../utils/auth";
import { sendEmail } from "../../../../app/lib/sendEmail";
import { getWelcomeAdminEmail } from "../../../utils/translations";
import { dummyPasswordCheck } from "../../../utils/password";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";

const runtimeConfig = useRuntimeConfig();
const appName = runtimeConfig.appName;
const loginURL = runtimeConfig.boardsUrl;
const defaultLanguage = runtimeConfig.language;

// Email validation regex
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    const {
      name,
      email,
      password,
      role = "user",
      type = "human",
      sendEmail: sendMail,
      onboarding = false,
    } = body;

    // "artificial" marks a non-human account (an AI agent). Only admins can
    // create one — public signup never sets this, so it defaults to human.
    if (type !== "human" && type !== "artificial") {
      event.res.statusCode = 400;
      return { error: "INVALID_TYPE" };
    }

    // Validate input with length limits for DoS protection
    if (!name || !email || !password) {
      event.res.statusCode = 400;
      return { error: "REQUIRED_FIELDS_MISSING" };
    }

    if (typeof name !== "string" || name.trim() === "" || name.length > 255) {
      event.res.statusCode = 400;
      return { error: "INVALID_NAME" };
    }

    if (
      typeof email !== "string" ||
      !emailRegex.test(email) ||
      email.length > 255
    ) {
      event.res.statusCode = 400;
      return { error: "INVALID_EMAIL" };
    }

    if (
      typeof password !== "string" ||
      password.length < 8 ||
      password.length > 255
    ) {
      event.res.statusCode = 400;
      return { error: "INVALID_PASSWORD" };
    }

    if (role !== "user" && role !== "admin") {
      event.res.statusCode = 400;
      return { error: "INVALID_ROLE" };
    }

    const db = await setupDatabase();

    // CRITICAL FIX: Use constant-time check for user existence
    const [existingUsers] = await db.execute(
      "SELECT * FROM `user` WHERE `email` = ?",
      [email],
    );

    const userExists = existingUsers.length > 0;

    if (userExists) {
      // The same cost as hashing the password below.
      await dummyPasswordCheck(password);
      event.res.statusCode = 400;
      return { error: "EMAIL_ALREADY_EXISTS" };
    }

    // Generate UUID for user
    const userId = uuidv4();

    // Hash the password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Use transaction for atomic user+account creation
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      // Create user in database. `onboarded` is set from the admin's choice:
      // opt-in to the first-run tour (0) or skip it (1, the default).
      // Bots don't read email, so artificial accounts start with notification
      // mails switched off (still changeable later).
      await conn.execute(
        "INSERT INTO `user` (`id`, `name`, `email`, `emailVerified`, `role`, `onboarded`, `type`, `emailNotifications`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
          userId,
          name.trim(),
          email,
          1,
          role,
          onboarding ? 0 : 1,
          type,
          type === "artificial" ? 0 : 1,
        ],
      );

      // Create account entry. Keyed by the user's id, not the address, which
      // can change (see sign-up.ts).
      await conn.execute(
        "INSERT INTO `account` (`id`, `accountId`, `providerId`, `userId`, `password`) VALUES (?, ?, ?, ?, ?)",
        [uuidv4(), userId, "local", userId, hashedPassword],
      );

      await conn.commit();
    } catch (error: any) {
      await conn.rollback();
      // The address was taken between the check above and the insert.
      if (error?.code === "ER_DUP_ENTRY") {
        event.res.statusCode = 400;
        return { error: "EMAIL_ALREADY_EXISTS" };
      }
      throw error;
    } finally {
      conn.release();
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
  } catch (error) {
    logger.error("Create user error:", error);
    event.res.statusCode = 500;
    return { error: "INTERNAL_SERVER_ERROR" };
  }
});
