import { readBody } from "h3";
import { recordCardActivity } from "../../utils/cardActivity";
import { copyCardAssignees } from "../../utils/cardAssignees";
import { putCardAfter } from "../../utils/cardPositions";
import { cardForBoard } from "../../utils/cards";
import { copyUpload, storedFileName } from "../../utils/fileUtils";
import { nameOf, notificationText, notifyBoard } from "../../utils/notify";
import { emitToBoard } from "../../utils/socket";
import { dispatchWebhooks } from "../../utils/webhooks";

// An attachment is stored one of three ways, and each is duplicated on its own
// terms:
//
//   * a path into `public/uploads` — the file on disk is COPIED and the copy
//     gets its own generated name. Two cards, two files, two independent
//     lifetimes: whatever happens to one card's attachment cannot reach the
//     other's.
//   * base64 in the row itself — copying the row copies the bytes, so there is
//     nothing on disk to share in the first place.
//   * an external `http(s)` URL — not ours to copy, so the copy points at the
//     same address, exactly as the original does.
const duplicateFile = async (filedata: string): Promise<string | null> => {
  const name = storedFileName(filedata);
  if (!name) return filedata;
  try {
    return await copyUpload(name);
  } catch (error) {
    // The original's file has gone. Better to leave the attachment off the
    // copy than to give it a row pointing at a file that is not there.
    logger.error("Attachment file could not be copied:", error);
    return null;
  }
};

export default dataHandler({
  // A copy of a card, directly below it.
  async POST({ event, db, userId, viaApiKey, cardOf }) {
    const { cardID } = await readBody(event);
    const { card: original, board } = await cardOf(cardID, "edit");

    // Everything the card is, except the conversation about it: the title, the
    // description with whatever checklist it holds, the due date and how it
    // repeats, the people on it and the done state. Comments are what people
    // said, in the order they said it, and they belong to the card they were
    // written on.
    const [inserted]: any = await db.execute(
      "INSERT INTO cards (area, name, content, status, sort, dueDate, repeatEvery, repeatAnchor, repeatArea, repeatNext) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        original.area,
        original.name,
        original.content || "",
        original.status ? 1 : 0,
        Number(original.sort),
        original.dueDate || null,
        original.repeatEvery || null,
        original.repeatAnchor || null,
        original.repeatArea ?? null,
        original.repeatNext || null,
      ],
    );
    const id = inserted.insertId;

    // The copy belongs directly under the original, not at the foot of a list
    // that may be long enough to hide it. Placed in the column's order rather
    // than by moving every higher number down one: a card that shares the
    // original's number would otherwise stay between the two.
    await putCardAfter(db, original.area, id, original.id);

    // The same due date wants the same reminders, and none of them has fired
    // for this card yet.
    await db.execute(
      "INSERT INTO card_reminders (card, minutesBefore, notified) SELECT ?, minutesBefore, 0 FROM card_reminders WHERE card = ?",
      [id, original.id],
    );
    await copyCardAssignees(db, original.id, id);
    // Its labels are the same board's, so the ids carry over as they are.
    await db.execute(
      "INSERT INTO `card_labels` (`card`, `label`) SELECT ?, `label` FROM `card_labels` WHERE `card` = ?",
      [id, original.id],
    );

    const [files]: any = await db.execute(
      "SELECT filename, filetype, filesize, filedata FROM attachments WHERE card = ? ORDER BY id ASC",
      [original.id],
    );
    const attachments: any[] = [];
    for (const file of files) {
      const filedata = await duplicateFile(file.filedata);
      if (filedata === null) continue;
      const [result]: any = await db.execute(
        "INSERT INTO attachments (card, filename, filetype, filesize, filedata) VALUES (?, ?, ?, ?, ?)",
        [id, file.filename, file.filetype, file.filesize, filedata],
      );
      attachments.push({
        id: result.insertId,
        filename: file.filename,
        filetype: file.filetype,
        filesize: file.filesize,
      });
    }

    // The way the board draws a card, with the files the card window opens
    // on — the shape GET /api/data/cards answers with — so the copy can go
    // straight into the list. It has nothing to say yet.
    const card = { ...(await cardForBoard(db, id)), comments: [], attachments };

    // A duplicate is a new card on the board, and everyone with access hears
    // about it the same way they hear about any other.
    await notifyBoard(db, {
      type: "card_created",
      boardId: board.id,
      cardId: id,
      message: notificationText.cardCreated(await nameOf(db, userId), card.name, board.name),
      actorId: userId,
    });
    await recordCardActivity(id, "created", userId);
    emitToBoard(board.id, "addCard", { boardId: board.id, card, after: original.id }, viaApiKey);
    dispatchWebhooks({
      boardId: board.id,
      event: "card.created",
      actorUserId: userId,
      card: { id, name: card.name, areaId: card.area },
    });

    return { card, attachments: attachments.length };
  },
});
