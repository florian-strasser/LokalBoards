import { getQuery } from "h3";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { hashToken } from "../../utils/auth";

// Looks up an invitation link so the sign-up form can show who it is for.
//
// Unauthenticated by necessity — the person following the link has no account
// yet, that being the point. It returns the address the invitation was issued
// to and the board's name, and nothing else: no board id, no inviter, no user
// data. Knowing the token is knowing the address already, since it was sent
// there.
export default defineEventHandler(async (event) => {
  const token = String(getQuery(event).token || "");

  // A token that is not even the right shape never reaches the database.
  if (!/^[a-f0-9]{64}$/.test(token)) {
    event.res.statusCode = 404;
    return { error: "INVALID_INVITATION" };
  }

  try {
    const db = setupDatabase();

    const [rows]: any = await db.execute(
      `SELECT i.email, i.expiresAt, i.usedAt, b.name AS boardName
       FROM board_email_invites i
       LEFT JOIN boards b ON b.id = i.board
       WHERE i.tokenHash = ?`,
      [hashToken(token)],
    );

    const invite = rows[0];

    // One answer for "never existed", "already used" and "expired". Which of
    // the three it is tells an outsider something and helps nobody who holds a
    // genuine link.
    if (!invite || invite.usedAt || new Date(invite.expiresAt) < new Date()) {
      event.res.statusCode = 404;
      return { error: "INVALID_INVITATION" };
    }

    return { email: invite.email, boardName: invite.boardName };
  } catch (error) {
    logger.error("Invitation lookup failed:", error);
    event.res.statusCode = 500;
    return { error: "Internal server error" };
  }
});
