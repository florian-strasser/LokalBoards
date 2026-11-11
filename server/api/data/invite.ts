import { readBody } from "h3";
import { sendEmail } from "../../../app/lib/sendEmail";
import {
  getBoardInviteEmail,
  getBoardInviteSignupEmail,
} from "../../utils/emails";
import { hashToken } from "../../utils/auth";
import { newSecret } from "../../utils/oauth";
import { isEmail } from "../../utils/password";

const runtimeConfig = useRuntimeConfig();
const appName = runtimeConfig.appName;
const baseURL = runtimeConfig.boardsUrl;
const defaultLanguage = runtimeConfig.language;

// The people invited to a board, and adding or removing one. All of it is the
// owner's alone: somebody invited to edit a board can change what is on it,
// not who else may see it.

export default dataHandler({
  // The invitations to a board, with the face and name of each person.
  async GET({ db, userId, query, boardOf }) {
    const { board } = await boardOf(query.boardId, "edit");
    if (board.user !== userId) fail(403, "Unauthorized access");

    const [invitations] = await db.query(
      `SELECT
        invitations.*,
        user.name AS userName,
        user.image AS userImage
      FROM invitations
      LEFT JOIN user ON invitations.user = user.id
      WHERE invitations.board = ?`,
      [board.id],
    );
    return { invitations };
  },

  // Somebody given access, picked by their id from the directory or — the
  // older way, and the only way for somebody without an account yet — by
  // their address.
  async POST({ event, db, userId, boardOf }) {
    const { boardId, mail, userId: inviteeId, permission } = await readBody(event);
    if (!boardId || (!mail && !inviteeId) || !permission) {
      fail(400, "Required fields are missing");
    }
    const { board } = await boardOf(boardId, "edit");
    if (board.user !== userId) fail(403, "Unauthorized access");

    const [invitees] = inviteeId
      ? await db.query("SELECT * FROM user WHERE id = ?", [inviteeId])
      : await db.query("SELECT * FROM user WHERE email = ?", [mail]);
    if (invitees.length === 0) {
      // Nobody here holds that address. If the caller gave us one, invite them
      // to the instance: a token goes to the address, and signing up through
      // it creates the account and grants this board. Without an address —
      // i.e. a picked user id that no longer resolves — there is nothing to
      // send, and the response stays the same either way so a board owner
      // still cannot use this to discover which addresses have accounts.
      if (mail) {
        const address = String(mail).trim().toLowerCase();

        if (isEmail(address)) {
          await inviteByEmail({
            db,
            boardId: board.id,
            board,
            address,
            permission,
            invitedBy: userId,
            appName,
            baseURL,
            language: defaultLanguage,
          });
        }
      }
      return { message: "Invitation created successfully", invitation: null };
    }
    const invitee = invitees[0];

    const [existing] = await db.query(
      "SELECT id FROM invitations WHERE board = ? AND user = ?",
      [board.id, invitee.id],
    );
    if (existing.length > 0) fail(400, "Invitation already exists");
    if (userId === invitee.id) fail(400, "Cannot invite yourself");

    const [result] = await db.query(
      "INSERT INTO invitations (board, user, permission) VALUES (?, ?, ?)",
      [board.id, invitee.id, permission],
    );

    // Email the invited user directly with a link to the board and their
    // access level. Best-effort: a mail hiccup must not fail the invite.
    try {
      const [inviterRows] = await db.query("SELECT name FROM user WHERE id = ?", [
        userId,
      ]);
      const { subject, html } = getBoardInviteEmail({
        appName,
        name: invitee.name,
        inviterName: inviterRows[0]?.name || appName,
        boardName: board.name,
        permission,
        boardURL: `${baseURL}/board/${board.id}`,
        language: defaultLanguage,
      });
      await sendEmail({ to: invitee.email, subject, text: html });
    } catch (mailError) {
      logger.error("Board invite email failed:", mailError);
    }

    const [invitationRows] = await db.query(
      `SELECT
        invitations.*,
        user.name AS userName,
        user.image AS userImage
      FROM invitations
      LEFT JOIN user ON invitations.user = user.id
      WHERE invitations.id = ?`,
      [result.insertId],
    );

    // A new face on the board: every dashboard showing it has an avatar to
    // add, and anyone with the board open has a member list to refresh.
    await notifyBoardMembersChanged(board.id);
    await notifyDashboards(db, board.id);

    return {
      message: "Invitation created successfully",
      invitation: invitationRows[0],
    };
  },

  // Somebody's access taken away again, with everything that hung off it
  // (webhook subscriptions, notifications) — see removeBoardMember. Only an
  // invitation to this board can be removed, so no other id can be reached
  // through it.
  async DELETE({ db, userId, query, boardOf }) {
    const memberId = query.userId;
    if (!memberId) fail(400, "Invalid ID values");
    const { board } = await boardOf(
      positiveId(query.boardId, "Invalid ID values"),
      "edit",
    );
    if (board.user !== userId) fail(403, "Unauthorized access");

    if (!(await removeBoardMember(db, board.id, String(memberId)))) {
      fail(404, "Resource not found");
    }

    // The removed user's own dashboard has a tile to lose, and they are no
    // longer a member — so they are told before the membership is re-read.
    await notifyDashboards(db, board.id, [String(memberId)]);
    await notifyBoardMembersChanged(board.id);
    await notifyDashboards(db, board.id);

    return { message: "Invitation removed successfully" };
  },
});

// Invite an address that has no account here yet.
//
// Re-inviting the same address to the same board replaces the outstanding
// invitation rather than accumulating live tokens: the newest link is the only
// one that works, which is what somebody clicking "invite" a second time
// expects — they think they are resending it.
//
// Best-effort by design. The board owner has already been told the invitation
// was sent; a mail server that is briefly down should leave a row behind and a
// line in the log, not an error on a screen they can do nothing about.
async function inviteByEmail({
  db,
  boardId,
  board,
  address,
  permission,
  invitedBy,
  appName,
  baseURL,
  language,
}: {
  db: any;
  boardId: number;
  board: any;
  address: string;
  permission: string;
  invitedBy: string;
  appName: string;
  baseURL: string;
  language: string;
}) {
  // 256 random bits, and only their hash is stored — like every other token.
  const token = newSecret();
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  try {
    await db.execute(
      "DELETE FROM `board_email_invites` WHERE `board` = ? AND `email` = ? AND `usedAt` IS NULL",
      [boardId, address],
    );
    await db.execute(
      "INSERT INTO `board_email_invites` (`board`, `email`, `permission`, `tokenHash`, `invitedBy`, `expiresAt`) VALUES (?, ?, ?, ?, ?, ?)",
      [
        boardId,
        address,
        permission === "edit" ? "edit" : "read",
        hashToken(token),
        invitedBy,
        expiresAt,
      ],
    );
  } catch (error) {
    logger.error("Email invitation could not be stored:", error);
    return;
  }

  try {
    const [inviterRows] = await db.query("SELECT name FROM user WHERE id = ?", [
      invitedBy,
    ]);
    const { subject, html } = getBoardInviteSignupEmail({
      appName,
      inviterName: inviterRows[0]?.name || appName,
      boardName: board.name,
      permission,
      signupURL: `${baseURL}/sign-up/?invite=${token}`,
      language,
    });
    await sendEmail({ to: address, subject, text: html });
  } catch (mailError) {
    logger.error("Email invitation could not be sent:", mailError);
  }
}
