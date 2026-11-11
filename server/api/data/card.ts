import { readBody } from "h3";
import { assigneeIdsFrom } from "../../utils/cardAssignees";
import { archiveCard, cardForBoard, createCard, updateCard } from "../../utils/cards";
import { isRepeatEvery } from "../../utils/repeat";

// A card's files as the app shows them.
const ATTACHMENT_COLUMNS = "id, filename, filetype, filesize, filedata";

// A date from the request, or a 400 for one that is not a date.
function dateFrom(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) fail(400, "Invalid due date");
  return date;
}

export default dataHandler({
  // One card, with its files.
  async GET({ db, query, cardOf }) {
    const id = Array.isArray(query.cardID) ? query.cardID[0] : query.cardID;
    const { card } = await cardOf(id, "read");
    const [attachments] = await db.execute(
      `SELECT ${ATTACHMENT_COLUMNS} FROM attachments WHERE card = ?`,
      [card.id],
    );
    return { card: await cardForBoard(db, card.id), attachments };
  },

  // A new card at the bottom of an area.
  async POST({ event, db, userId, viaApiKey, areaOf }) {
    const { areaId, name, content, status } = await readBody(event);
    if (!areaId || !name) fail(400, "Required fields are missing");
    const { area, board } = await areaOf(positiveId(areaId, "Invalid area ID"), "edit");
    if (area.archivedAt) fail(404, "Resource not found");
    const { card } = await createCard(
      db,
      { area, board },
      userId,
      { name, content, done: !!status },
      viaApiKey,
    );
    return { card };
  },

  // A card changed. The fields it describes are replaced as a whole — what is
  // left out of name, content, status and the due date is emptied — while
  // labels, reminders, the people on it and the rhythm are left alone unless
  // they are sent. Files sent along are added to it.
  async PUT({ event, db, userId, viaApiKey, cardOf }) {
    const body = await readBody(event);
    const { cardID, name, content, status, files, dueDate, reminders, labelIds, repeatEvery } = body;
    if (!cardID || !name) fail(400, "Required fields are missing");

    // Absent leaves the rhythm alone, empty stops it; anything else has to be
    // one of the rhythms there are.
    if (repeatEvery !== undefined && repeatEvery !== null && repeatEvery !== "" && !isRepeatEvery(repeatEvery)) {
      fail(400, "Invalid repeat value");
    }
    const found = await cardOf(positiveId(cardID, "Invalid card ID"), "edit");

    // `assignees` replaces everyone on the card; the older single `assignee`
    // replaces them with that one person, or with nobody.
    const assigneeIds = Array.isArray(body.assignees)
      ? assigneeIdsFrom(body.assignees)
      : "assignee" in body
        ? assigneeIdsFrom(body.assignee ? [body.assignee] : [])
        : undefined;

    const added: number[] = [];
    for (const file of Array.isArray(files) ? files : []) {
      const [result] = await db.execute(
        "INSERT INTO attachments (card, filename, filetype, filesize, filedata) VALUES (?, ?, ?, ?, ?)",
        [found.card.id, file.filename, file.filetype, file.filesize, file.filedata],
      );
      added.push(result.insertId);
    }
    const [attachments] = added.length
      ? await db.query(`SELECT ${ATTACHMENT_COLUMNS} FROM attachments WHERE id IN (?)`, [added])
      : [[]];

    const card = await updateCard(
      db,
      found,
      userId,
      {
        name,
        content: content || "",
        done: !!status,
        dueDate: dateFrom(dueDate),
        repeat: repeatEvery,
        assigneeIds,
        labelIds: Array.isArray(labelIds) ? labelIds : undefined,
        reminders: Array.isArray(reminders) ? reminders : undefined,
      },
      viaApiKey,
      attachments,
    );
    return { card, attachments };
  },

  // Into the archive, keeping everything it has; or — when the archive itself
  // asks — gone for good.
  async DELETE({ event, db, userId, viaApiKey, cardOf }) {
    const { cardID, permanent } = await readBody(event);
    const found = await cardOf(positiveId(cardID, "Invalid card ID"), "edit");
    await archiveCard(db, found, userId, viaApiKey, !!permanent);
    return {
      message: permanent ? "Card deleted successfully" : "Card archived successfully",
      card: found.card,
    };
  },
});
