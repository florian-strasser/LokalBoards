import { setupDatabase } from "../../../app/lib/databaseSetup";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { getCookie } from "h3";
import { createSession, hashToken } from "../../utils/auth";
import { dummyPasswordCheck } from "../../utils/password";
import { sendEmail } from "../../../app/lib/sendEmail";
import { getWelcomeSignupEmail } from "../../utils/translations";
import { hashInviteToken } from "../../utils/inviteToken";

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig();
  const allowSignup =
    runtimeConfig.public.signup === true
      ? true
      : runtimeConfig.public.signup === "true"
        ? true
        : false;

  // A board invitation carries its own permission to register, so a link that
  // was sent to one address works even on an instance with public signup turned
  // off. Everything else about the flow is unchanged — same validation, same
  // password rules, same account.
  const body = (await readBody(event).catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const inviteToken =
    typeof body.inviteToken === "string" && /^[a-f0-9]{64}$/.test(body.inviteToken)
      ? body.inviteToken
      : "";

  let invite: {
    id: number;
    board: number;
    email: string;
    permission: string;
  } | null = null;

  if (inviteToken) {
    try {
      const db = await setupDatabase();
      const [rows]: any = await db.execute(
        "SELECT `id`, `board`, `email`, `permission` FROM `board_email_invites` WHERE `tokenHash` = ? AND `usedAt` IS NULL AND `expiresAt` > NOW()",
        [hashInviteToken(inviteToken)],
      );
      invite = rows[0] ?? null;
    } catch (error) {
      logger.error("Invitation lookup during signup failed:", error);
    }
  }

  if (allowSignup || invite) {
    const method = event.req.method;
    // HIGH FIX: Use 405 Method Not Allowed instead of 403
    if (method !== "POST") {
      event.res.statusCode = 405;
      return { error: "Method not allowed" };
    }

    // Check if user already has an active session
    const sessionToken =
      event.headers.get("authorization")?.replace("Bearer ", "") ||
      getCookie(event, "session_token");

    if (sessionToken) {
      try {
        const db = await setupDatabase();
        const [sessions] = await db.execute(
          "SELECT * FROM `session` WHERE `token` = ? AND `expiresAt` > NOW()",
          [hashToken(sessionToken)],
        );

        if (sessions.length > 0) {
          event.res.statusCode = 400;
          return {
            error: "Registration failed",
          };
        }
      } catch (error) {
        logger.error("Session check error:", error);
        // HIGH FIX: Don't fail silently - continue with signup but log
      }
    }

    try {
      const { name, password, callbackURL } = body as any;
      // An invitation decides its own address. Taking it from the request would
      // let anyone holding the link register under a different one, which is
      // the whole thing the token is meant to prevent.
      const email = invite ? invite.email : ((body as any).email as string);

      // HIGH FIX: Validate input with generic messages
      if (!name || !email || !password) {
        event.res.statusCode = 400;
        return { error: "Registration failed" };
      }

      // HIGH FIX: Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        event.res.statusCode = 400;
        return { error: "Registration failed" };
      }

      // HIGH FIX: Validate password length (min 8 chars)
      if (typeof password !== "string" || password.length < 8) {
        event.res.statusCode = 400;
        return { error: "Registration failed" };
      }

      // Initialize the database
      const db = await setupDatabase();

      // CRITICAL FIX: Use constant-time check to prevent timing attacks
      // Check if email exists first
      const [existingUsers] = await db.execute(
        "SELECT * FROM `user` WHERE `email` = ?",
        [email],
      );

      const userExists = existingUsers.length > 0;

      // HIGH FIX: Generic error message to prevent user enumeration. The
      // refusal costs what hashing the new password below costs.
      if (userExists) {
        await dummyPasswordCheck(password);
        event.res.statusCode = 400;
        return { error: "Registration failed" };
      }

      // Hash the password
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      // Generate a UUID for the user
      const userId = uuidv4();

      // Use transaction via pool connection for atomic user+account creation
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();

        // Insert the user into the database
        await conn.execute(
          "INSERT INTO `user` (`id`, `name`, `email`, `emailVerified`) VALUES (?, ?, ?, ?)",
          [userId, name, email, 0],
        );

        // Create an account entry for the user. A password belongs to the
        // user, not to an address, so the local `accountId` is the user's id:
        // the address can change, and the old one must be free to sign up
        // with again (the `account_provider_subject` index is unique).
        await conn.execute(
          "INSERT INTO `account` (`id`, `accountId`, `providerId`, `userId`, `password`) VALUES (?, ?, ?, ?, ?)",
          [uuidv4(), userId, "local", userId, hashedPassword],
        );

        // The invitation is honoured and spent in the same transaction that
        // creates the account: either the user exists with access to the board
        // and the token is dead, or none of it happened.
        //
        // `usedAt IS NULL` in the UPDATE is the guard that makes it single-use.
        // Two people racing the same link both reach this line; only one of them
        // updates a row, and the other rolls the whole registration back.
        if (invite) {
          const [spent]: any = await conn.execute(
            "UPDATE `board_email_invites` SET `usedAt` = CURRENT_TIMESTAMP WHERE `id` = ? AND `usedAt` IS NULL",
            [invite.id],
          );
          if (spent.affectedRows !== 1) {
            throw new Error("Invitation was already used");
          }
          await conn.execute(
            "INSERT INTO `invitations` (`board`, `user`, `permission`) VALUES (?, ?, ?)",
            [invite.board, userId, invite.permission],
          );
        }

        // Commit transaction
        await conn.commit();

        // Send a welcome email (public-signup variant, no credentials).
        // Best-effort: never let a mail hiccup break registration.
        try {
          const { subject, html } = getWelcomeSignupEmail({
            appName: runtimeConfig.appName,
            name,
            loginURL: runtimeConfig.boardsUrl,
            language: runtimeConfig.language,
          });
          await sendEmail({ to: email, subject, text: html });
        } catch (mailError) {
          logger.error("Welcome email (signup) failed:", mailError);
        }

        // Create a session for the newly registered user
        const sessionResult = await createSession(event, userId);

        if (sessionResult.error) {
          logger.error("Session creation failed:", sessionResult.error);
          // Continue without session - user can still log in manually
        }

        // Return success response with user details and session token
        return {
          data: {
            success: true,
            message: "User registered successfully",
            user: {
              id: userId,
              name: name,
              email: email,
              role: "user", // Default role
            },
            sessionToken: sessionResult?.sessionToken,
            callbackURL,
          },
        };
      } catch (error: any) {
        // Rollback transaction on any error
        await conn.rollback();
        // Somebody registered the same address between the check above and
        // the insert; `user.email` is unique, so the database said no. The
        // same answer as an address that was already taken.
        if (error?.code === "ER_DUP_ENTRY") {
          event.res.statusCode = 400;
          return { error: "Registration failed" };
        }
        throw error;
      } finally {
        conn.release();
      }
    } catch (error) {
      logger.error("Signup error:", error);
      event.res.statusCode = 500;
      return { error: "Internal server error" };
    }
  } else {
    // A refusal with a 2xx is an error wearing a success code: it looks fine to
    // anything reading the status rather than the body — proxies, logs, tests.
    event.res.statusCode = 403;
    return { error: "DISABLED_SIGNUP" };
  }
});
