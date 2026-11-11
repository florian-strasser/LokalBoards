import { createSession, hashToken, resolveSession } from "../../utils/auth";
import {
  createLocalUser,
  dummyPasswordCheck,
  isEmail,
  isPasswordLongEnough,
} from "../../utils/password";
import { sendEmail } from "../../../app/lib/sendEmail";
import { getWelcomeSignupEmail } from "../../utils/emails";

type Invitation = {
  id: number;
  board: number;
  email: string;
  permission: string;
};

// The unused, unexpired invitation behind a link's token, or null. A lookup
// that fails is logged and counts as no invitation, which leaves the decision
// to the instance's own signup setting.
async function invitationFor(db: any, token: unknown): Promise<Invitation | null> {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return null;
  try {
    const [rows]: any = await db.execute(
      "SELECT `id`, `board`, `email`, `permission` FROM `board_email_invites` WHERE `tokenHash` = ? AND `usedAt` IS NULL AND `expiresAt` > NOW()",
      [hashToken(token)],
    );
    return rows[0] ?? null;
  } catch (error) {
    logger.error("Invitation lookup during signup failed:", error);
    return null;
  }
}

export default authHandler("POST", "anyone", async ({ event, db }) => {
  const runtimeConfig = useRuntimeConfig();
  const allowSignup =
    runtimeConfig.public.signup === true ||
    runtimeConfig.public.signup === "true";

  // A board invitation carries its own permission to register, so a link that
  // was sent to one address works even on an instance with public signup turned
  // off. Everything else about the flow is unchanged — same validation, same
  // password rules, same account.
  const body = (await readBody(event).catch(() => ({}))) as Record<string, any>;
  const invite = await invitationFor(db, body.inviteToken);

  // A refusal with a 2xx is an error wearing a success code: it looks fine to
  // anything reading the status rather than the body — proxies, logs, tests.
  if (!allowSignup && !invite) fail(403, "DISABLED_SIGNUP");

  // Somebody who is signed in already has an account. A check that fails is
  // logged and lets the registration through rather than turning it away.
  const current = await resolveSession(event).catch((error) => {
    logger.error("Session check error:", error);
    return null;
  });
  if (current && current.status !== "invalid") fail(400, "Registration failed");

  const { name, password, callbackURL } = body;
  // An invitation decides its own address. Taking it from the request would
  // let anyone holding the link register under a different one, which is the
  // whole thing the token is meant to prevent.
  const email = invite ? invite.email : body.email;

  // One answer for everything that goes wrong, so the form cannot be used to
  // find out which addresses have an account.
  if (!name || !email || !password) fail(400, "Registration failed");
  if (!isEmail(email) || !isPasswordLongEnough(password)) {
    fail(400, "Registration failed");
  }

  const [existingUsers] = await db.execute(
    "SELECT * FROM `user` WHERE `email` = ?",
    [email],
  );
  if (existingUsers.length > 0) {
    // The refusal costs what hashing the new password costs.
    await dummyPasswordCheck(password);
    fail(400, "Registration failed");
  }

  let userId: string;
  try {
    userId = await createLocalUser(
      db,
      { name, email, emailVerified: 0 },
      password,
      // The invitation is honoured and spent in the same transaction that
      // creates the account: either the user exists with access to the board
      // and the token is dead, or none of it happened.
      //
      // `usedAt IS NULL` in the UPDATE is the guard that makes it single-use.
      // Two people racing the same link both reach this line; only one of them
      // updates a row, and the other rolls the whole registration back.
      async (conn, newUserId) => {
        if (!invite) return;
        const [spent]: any = await conn.execute(
          "UPDATE `board_email_invites` SET `usedAt` = CURRENT_TIMESTAMP WHERE `id` = ? AND `usedAt` IS NULL",
          [invite.id],
        );
        if (spent.affectedRows !== 1) {
          throw new Error("Invitation was already used");
        }
        await conn.execute(
          "INSERT INTO `invitations` (`board`, `user`, `permission`) VALUES (?, ?, ?)",
          [invite.board, newUserId, invite.permission],
        );
      },
    );
  } catch (error: any) {
    // Somebody registered the same address between the check above and the
    // insert; `user.email` is unique, so the database said no. The same answer
    // as an address that was already taken.
    if (error?.code === "ER_DUP_ENTRY") fail(400, "Registration failed");
    throw error;
  }

  // A welcome email (the public-signup kind, no credentials). Best-effort: a
  // mail hiccup never breaks registration.
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

  // Signed in straight away. Without a session they can still sign in by hand.
  const sessionResult = await createSession(event, userId);
  if (sessionResult.error) {
    logger.error("Session creation failed:", sessionResult.error);
  }

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
});
