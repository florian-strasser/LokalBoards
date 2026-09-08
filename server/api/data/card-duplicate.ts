import { defineEventHandler, readBody } from "h3";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { dispatchWebhooks } from "../../utils/webhooks";
import { getServerSocket } from "../../utils/socket";

// An attachment is stored one of three ways, and each is duplicated on its own
// terms:
//
//   * a path into `public/uploads` — the file on disk is COPIED and the copy
//     gets its own generated name. Pointing both rows at one file would look
//     right until the day somebody deleted either card's attachment: the delete
//     handler unlinks the file, and the other card would be left with a row
//     pointing at nothing. Two cards, two files, two independent lifetimes.
//   * base64 in the row itself — copying the row copies the bytes, so there is
//     nothing on disk to share in the first place.
//   * an external `http(s)` URL — not ours to copy, so the copy points at the
//     same address, exactly as the original does.
const STORED_FILE = /^\/(?:api\/)?uploads\/([A-Za-z0-9._-]+)$/;

const duplicateFile = async (filedata: string): Promise<string | null> => {
  const stored = String(filedata || "").match(STORED_FILE);
  if (!stored) return filedata; // base64 or an external URL: nothing to copy.

  const { copyFile } = await import("node:fs/promises");
  const { join, resolve, extname } = await import("node:path");
  const { randomBytes } = await import("node:crypto");

  const uploadDir = resolve(join(process.cwd(), "public", "uploads"));
  const source = resolve(uploadDir, stored[1]);
  // The pattern excludes separators already; resolve and check anyway, the same
  // guard /api/uploads and the delete handler apply.
  if (!source.startsWith(uploadDir)) return null;

  const extension = extname(stored[1]);
  const name = `${randomBytes(16).toString("hex")}${extension}`;
  try {
    // `copyFile` fails if the source has gone. Better to leave the attachment
    // off the copy than to give it a row pointing at a file that is not there.
    await copyFile(source, resolve(uploadDir, name));
  } catch (error) {
    logger.error("Attachment file could not be copied:", error);
    return null;
  }
  return `/api/uploads/${name}`;
};

export default defineEventHandler(async (event) => {
  if (event.req.method !== "POST") {
    event.res.statusCode = 405;
    return { error: "Method not allowed" };
  }

  const auth = await resolveUserId(event);
  if (!auth.ok) {
    event.res.statusCode = auth.status;
    return { error: auth.error };
  }
  const userId = auth.userId;

  try {
    const db = setupDatabase();
    const { cardID } = await readBody(event);

    if (!cardID || isNaN(Number(cardID)) || Number(cardID) <= 0) {
      event.res.statusCode = 400;
      return { error: "Invalid card ID" };
    }

    const [cardRows]: any = await db.execute(
      "SELECT * FROM cards WHERE id = ?",
      [cardID],
    );
    const original = cardRows[0];
    if (!original) {
      // Generic error to prevent card enumeration.
      event.res.statusCode = 404;
      return { error: "Resource not found" };
    }

    const [boardRows]: any = await db.execute(
      "SELECT b.* FROM boards b JOIN areas a ON b.id = a.board WHERE a.id = ?",
      [original.area],
    );
    const board = boardRows[0];
    if (!board) {
      event.res.statusCode = 404;
      return { error: "Resource not found" };
    }

    const decision = await authorizeBoard(db, board, userId, "edit");
    if (!decision.ok) {
      event.res.statusCode = decision.status;
      return { error: decision.error };
    }

    // The copy belongs directly under the original, not at the foot of a list
    // that may be long enough to hide it. Everything below moves down one.
    await db.execute(
      "UPDATE cards SET sort = sort + 1 WHERE area = ? AND sort > ?",
      [original.area, original.sort],
    );

    // Everything the card is, except the conversation about it: the title, the
    // description with whatever checklist it holds, the due date, the assignee
    // and the done state. Comments are what people said, in the order they said
    // it, and they belong to the card they were written on.
    const [inserted]: any = await db.execute(
      "INSERT INTO cards (area, name, content, status, sort, dueDate, assignee) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        original.area,
        original.name,
        original.content || "",
        original.status ? 1 : 0,
        Number(original.sort) + 1,
        original.dueDate || null,
        original.assignee || null,
      ],
    );
    const newCardId = inserted.insertId;

    // The same due date wants the same reminders, and none of them has fired
    // for this card yet.
    const [reminders]: any = await db.execute(
      "SELECT minutesBefore FROM card_reminders WHERE card = ?",
      [cardID],
    );
    for (const reminder of reminders) {
      await db.execute(
        "INSERT INTO card_reminders (card, minutesBefore, notified) VALUES (?, ?, 0)",
        [newCardId, reminder.minutesBefore],
      );
    }

    // A copy of a card is a copy of what it says about itself, labels included.
    // They belong to the same board, so the ids carry over as they are.
    await db.execute(
      "INSERT INTO `card_labels` (`card`, `label`) SELECT ?, `label` FROM `card_labels` WHERE `card` = ?",
      [newCardId, cardID],
    );

    const [attachments]: any = await db.execute(
      "SELECT filename, filetype, filesize, filedata FROM attachments WHERE card = ? ORDER BY id ASC",
      [cardID],
    );
    let copiedAttachments = 0;
    for (const attachment of attachments) {
      const filedata = await duplicateFile(attachment.filedata);
      if (filedata === null) continue;
      await db.execute(
        "INSERT INTO attachments (card, filename, filetype, filesize, filedata) VALUES (?, ?, ?, ?, ?)",
        [
          newCardId,
          attachment.filename,
          attachment.filetype,
          attachment.filesize,
          filedata,
        ],
      );
      copiedAttachments += 1;
    }

    // The shape the board renders a card from — the same columns and counts
    // `cards.ts` returns, so the copy can be dropped straight into the list.
    const [newRows]: any = await db.execute(
      "SELECT c.id, c.area, c.name, c.content, c.status, c.sort, c.dueDate, c.assignee, au.name AS assigneeName, au.image AS assigneeImage, au.type AS assigneeType, (SELECT COUNT(*) FROM comments co WHERE co.card = c.id) as commentCount, (SELECT COUNT(*) FROM attachments a WHERE a.card = c.id) as attachmentCount FROM cards c LEFT JOIN user au ON au.id = c.assignee WHERE c.id = ?",
      [newCardId],
    );
    const card = newRows[0];

    // A duplicate is a new card on the board, and everyone with access hears
    // about it the same way they hear about any other.
    const [invitedUsers]: any = await db.execute(
      "SELECT user FROM invitations WHERE board = ?",
      [board.id],
    );
    const [userRows]: any = await db.execute(
      "SELECT name FROM user WHERE id = ?",
      [userId],
    );
    const username = userRows[0]?.name || "Unknown user";
    const usersToNotify = [
      board.user,
      ...invitedUsers.map((invitation: any) => invitation.user),
    ].filter(Boolean);

    for (const notifyUserId of usersToNotify) {
      if (notifyUserId === userId) continue;
      await db.execute(
        "INSERT INTO notifications (userId, type, boardId, cardId, message, actorId) VALUES (?, ?, ?, ?, ?, ?)",
        [
          notifyUserId,
          "card_created",
          board.id,
          card.id,
          `"${username}" created a new card "${card.name}" on board "${board.name}"`,
          userId,
        ],
      );
    }

    await recordCardActivity(card.id, "created", userId);

    // The browser emits this for itself; an API client has no socket to do it.
    if (auth.viaApiKey) {
      getServerSocket().to(`board-${board.id}`).emit("addCard", {
        boardId: board.id,
        card,
      });
    }

    dispatchWebhooks({
      boardId: board.id,
      event: "card.created",
      actorUserId: userId,
      card: { id: card.id, name: card.name, areaId: card.area },
    });

    return { card, attachments: copiedAttachments };
  } catch (error) {
    logger.error("Database error:", error);
    event.res.statusCode = 500;
    return { error: "Internal server error" };
  }
});
