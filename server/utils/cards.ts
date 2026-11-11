import { attachAssignees, setCardAssignees } from "./cardAssignees";
import { recordCardActivity } from "./cardActivity";
import { removeCardData } from "./cardCleanup";
import { nextCardSort, putCard, renumberColumn } from "./cardPositions";
import { pruneUnusedLabels } from "./labelCleanup";
import { serializeCard } from "./mcpHelpers";
import { nameOf, notificationText, notifyBoard, notifyUser } from "./notify";
import { repeatAfterEdit } from "./repeat";
import { emitToBoard } from "./socket";
import { dispatchWebhooks } from "./webhooks";

// A card made, changed, moved, reordered or archived: the one way each is done,
// whether the app, the REST API or an agent over MCP asks for it. With one
// implementation the two ways in cannot drift apart again — they had: MCP
// wrote no history, told nobody it had put them on a card, and deleted for
// good where the app archives.
//
// Access is the caller's to check first (see access.ts), and so is turning
// what arrived into the values below. `broadcast` is whether to tell whoever
// has the board open: a browser tells the others itself, so it is the API and
// MCP that ask for it.

/** A card the way the board draws it: its counts, reminders, labels and people. */
export async function cardForBoard(db: any, id: number | string) {
  const [rows]: any = await db.execute(
    "SELECT c.*, (SELECT COUNT(*) FROM comments co WHERE co.card = c.id) AS commentCount, (SELECT COUNT(*) FROM attachments a WHERE a.card = c.id) AS attachmentCount FROM cards c WHERE c.id = ?",
    [id],
  );
  const card = rows[0];
  if (!card) return null;
  card.status = !!card.status;
  const [reminders]: any = await db.execute(
    "SELECT minutesBefore FROM card_reminders WHERE card = ? ORDER BY minutesBefore ASC",
    [id],
  );
  card.reminders = reminders.map((row: any) => row.minutesBefore);
  const [labels]: any = await db.execute(
    "SELECT l.id, l.name FROM `card_labels` cl JOIN `labels` l ON l.id = cl.label WHERE cl.card = ? ORDER BY l.sort ASC, l.id ASC",
    [id],
  );
  card.labels = labels;
  return (await attachAssignees(db, [card]))[0];
}

export interface NewCard {
  name: string;
  content?: string;
  done?: boolean;
  dueDate?: Date | null;
  repeat?: string | null;
  assigneeIds?: string[];
  /** A retry with the same key in the same area gets the card made the first time. */
  idempotencyKey?: string | null;
}

async function byIdempotencyKey(db: any, areaId: number, key: string) {
  const [rows]: any = await db.execute(
    "SELECT * FROM cards WHERE area = ? AND idempotencyKey = ?",
    [areaId, key],
  );
  return rows[0] ? (await attachAssignees(db, rows))[0] : null;
}

/** A new card at the bottom of the area. */
export async function createCard(
  db: any,
  { area, board }: { area: any; board: any },
  actorId: string,
  fields: NewCard,
  broadcast: boolean,
): Promise<{ card: any; created: boolean }> {
  const key = fields.idempotencyKey || null;
  if (key) {
    const earlier = await byIdempotencyKey(db, area.id, key);
    if (earlier) return { card: earlier, created: false };
  }

  const due = fields.dueDate ?? null;
  const repeat = fields.repeat || null;
  // Where the series is counted from, and when it is next owed a card: the due
  // date if there is one, otherwise from now (see `repeat.ts`).
  const series = repeatAfterEdit({ area: area.id }, repeat ?? undefined, due, true);

  let id: number;
  try {
    const [result]: any = await db.execute(
      "INSERT INTO cards (area, name, content, status, sort, dueDate, idempotencyKey, repeatEvery, repeatAnchor, repeatArea, repeatNext) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        area.id,
        fields.name,
        fields.content || "",
        fields.done ? 1 : 0,
        await nextCardSort(db, area.id),
        due,
        key,
        repeat,
        repeat ? series.repeatAnchor : null,
        repeat ? area.id : null,
        repeat ? series.repeatNext : null,
      ],
    );
    id = result.insertId;
  } catch (error: any) {
    // A retry with the same key that got in first: theirs is the card.
    if (error?.code === "ER_DUP_ENTRY" && key) {
      const earlier = await byIdempotencyKey(db, area.id, key);
      if (earlier) return { card: earlier, created: false };
    }
    throw error;
  }

  if (fields.assigneeIds?.length) {
    await setCardAssignees(db, id, board.id, fields.assigneeIds);
  }
  const card = await cardForBoard(db, id);
  await recordCardActivity(id, "created", actorId);
  await notifyBoard(db, {
    type: "card_created",
    boardId: board.id,
    cardId: id,
    message: notificationText.cardCreated(await nameOf(db, actorId), card.name, board.name),
    actorId,
  });
  emitToBoard(board.id, "addCard", { boardId: board.id, card }, broadcast);
  dispatchWebhooks({
    boardId: board.id,
    event: "card.created",
    actorUserId: actorId,
    card: serializeCard(card),
  });
  return { card, created: true };
}

/** What changes; whatever is left out stays as it is. */
export interface CardPatch {
  name?: string;
  content?: string;
  done?: boolean;
  /** null takes the due date away. */
  dueDate?: Date | null;
  /** null or "" stops the card repeating. */
  repeat?: string | null;
  /** Everyone on the card from now on. */
  assigneeIds?: string[];
  /** The labels it wears from now on; only the board's own are taken. */
  labelIds?: number[];
  /** Reminders, in minutes before the due date. */
  reminders?: number[];
}

const timeOf = (value: Date | string | null | undefined) =>
  value ? new Date(value).getTime() : null;

/**
 * A card changed, with everything a change brings: its history, the people
 * told, reminders that fire again for a new due date, and the board and the
 * webhooks told.
 */
export async function updateCard(
  db: any,
  { card, board }: { card: any; board: any },
  actorId: string,
  patch: CardPatch,
  broadcast: boolean,
  attachments: any[] = [],
) {
  const id = Number(card.id);
  const done = patch.done ?? !!card.status;
  const due =
    patch.dueDate === undefined ? (card.dueDate ? new Date(card.dueDate) : null) : patch.dueDate;
  const dueChanged = timeOf(due) !== timeOf(card.dueDate);
  // The rhythm belongs to the due date, so it is worked out again when either
  // was sent, and left exactly as it is otherwise.
  const series =
    patch.repeat !== undefined || patch.dueDate !== undefined
      ? repeatAfterEdit(card, patch.repeat, due, dueChanged)
      : card;

  await db.execute(
    "UPDATE cards SET name = ?, content = ?, status = ?, dueDate = ?, repeatEvery = ?, repeatAnchor = ?, repeatArea = ?, repeatNext = ? WHERE id = ?",
    [
      patch.name ?? card.name,
      patch.content ?? card.content ?? "",
      done ? 1 : 0,
      due,
      series.repeatEvery ?? null,
      series.repeatAnchor ?? null,
      series.repeatArea ?? null,
      series.repeatNext ?? null,
      id,
    ],
  );
  const name = patch.name ?? card.name;

  if ((series.repeatEvery ?? null) !== (card.repeatEvery || null)) {
    await recordCardActivity(id, "repeat", actorId, { every: series.repeatEvery ?? null });
  }

  if (patch.reminders) {
    const wanted = [
      ...new Set(patch.reminders.map(Number).filter((m) => Number.isFinite(m) && m >= 0)),
    ];
    const [existingRows]: any = await db.execute(
      "SELECT minutesBefore FROM card_reminders WHERE card = ?",
      [id],
    );
    const existing = new Set<number>(existingRows.map((row: any) => row.minutesBefore));
    for (const minutes of existing) {
      if (!wanted.includes(minutes)) {
        await db.execute("DELETE FROM card_reminders WHERE card = ? AND minutesBefore = ?", [id, minutes]);
      }
    }
    for (const minutes of wanted) {
      if (!existing.has(minutes)) {
        await db.execute(
          "INSERT INTO card_reminders (card, minutesBefore, notified) VALUES (?, ?, 0)",
          [id, minutes],
        );
      }
    }
  }

  if (patch.labelIds) await relabel(db, id, board.id, actorId, patch.labelIds);

  // A new due date is one the reminders have not fired for yet.
  if (dueChanged) {
    await recordCardActivity(id, "due", actorId, { dueDate: due ? due.toISOString() : null });
    await db.execute("UPDATE card_reminders SET notified = 0 WHERE card = ?", [id]);
  }

  // Who came on and who went off. Both go in the card's history; the people
  // put on it by somebody else are told, and nobody is told that they put
  // themselves on a card.
  if (patch.assigneeIds) {
    const change = await setCardAssignees(db, id, board.id, patch.assigneeIds);
    const assigner = change.added.length ? await nameOf(db, actorId) : "";
    for (const assigneeId of change.added) {
      await recordCardActivity(id, "assigned", actorId, { assigneeId });
      if (assigneeId === actorId) continue;
      await notifyUser(db, assigneeId, {
        type: "card_assigned",
        boardId: board.id,
        cardId: id,
        message: notificationText.cardAssigned(assigner, name),
        actorId,
      });
    }
    for (const assigneeId of change.removed) {
      await recordCardActivity(id, "assigned", actorId, { assigneeId, removed: true });
    }
  }

  if (done !== !!card.status) {
    await recordCardActivity(id, "status", actorId, { done });
    await notifyBoard(db, {
      type: "card_status_changed",
      boardId: board.id,
      cardId: id,
      message: notificationText.cardStatus(name, done),
      actorId,
    });
  }

  const updated = await cardForBoard(db, id);
  emitToBoard(board.id, "updateCard", { boardId: board.id, attachments, card: updated }, broadcast);
  dispatchWebhooks({
    boardId: board.id,
    event: "card.updated",
    actorUserId: actorId,
    card: serializeCard(updated),
  });
  return updated;
}

// The labels a card wears, from the board's own. A label a card puts down is
// swept when no other card wears it — a label exists because a card uses it.
// Labelling goes in the card's history, not in the notifications: nobody needs
// telling by e-mail that a card is now marked "Bug".
async function relabel(
  db: any,
  cardId: number,
  boardId: number,
  actorId: string,
  labelIds: number[],
) {
  const wanted = [...new Set(labelIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  // Names alongside ids: the history is written from them, and a label about
  // to be swept would be gone by then.
  const nameById = new Map<number, string>();
  const allowed: number[] = [];
  if (wanted.length) {
    const [own]: any = await db.query(
      "SELECT `id`, `name` FROM `labels` WHERE board = ? AND id IN (?)",
      [boardId, wanted],
    );
    for (const row of own) {
      allowed.push(Number(row.id));
      nameById.set(Number(row.id), String(row.name));
    }
  }
  const [worn]: any = await db.execute(
    "SELECT l.`id`, l.`name` FROM `card_labels` cl JOIN `labels` l ON l.id = cl.label WHERE cl.`card` = ?",
    [cardId],
  );
  const before: number[] = [];
  for (const row of worn) {
    before.push(Number(row.id));
    nameById.set(Number(row.id), String(row.name));
  }
  await db.execute("DELETE FROM `card_labels` WHERE `card` = ?", [cardId]);
  for (const labelId of allowed) {
    await db.execute("INSERT INTO `card_labels` (`card`, `label`) VALUES (?, ?)", [cardId, labelId]);
  }
  const added = allowed.filter((id) => !before.includes(id));
  const removed = before.filter((id) => !allowed.includes(id));
  if (added.length || removed.length) {
    const named = (ids: number[]) => ids.map((id) => nameById.get(id)).filter(Boolean);
    await recordCardActivity(cardId, "labels", actorId, {
      added: named(added),
      removed: named(removed),
    });
  }
  await pruneUnusedLabels(db, removed);
}

/**
 * A card into another area — on its own board or on another one the caller
 * may edit — at a position counted the way the board counts. Returns where it
 * ended up.
 */
export async function moveCard(
  db: any,
  { card, area, board }: { card: any; area: any; board: any },
  to: { area: any; board: any },
  actorId: string,
  index: number | null | undefined,
  broadcast: boolean,
) {
  const at = await putCard(db, to.area.id, card.id, index);
  const changedArea = Number(area.id) !== Number(to.area.id);
  if (changedArea) await renumberColumn(db, area.id);
  const moved = await cardForBoard(db, card.id);

  if (changedArea) {
    await recordCardActivity(card.id, "moved", actorId, { from: area.name, to: to.area.name });
    await notifyBoard(db, {
      type: "card_moved",
      boardId: to.board.id,
      cardId: card.id,
      message: notificationText.cardMoved(card.name, area.name, to.area.name),
      actorId,
    });
    dispatchWebhooks({
      boardId: to.board.id,
      event: "card.moved",
      actorUserId: actorId,
      card: serializeCard(moved),
    });
  }

  // On its own board the card moves; to another board it leaves the one and
  // arrives on the other — an open board knows only its own columns.
  if (Number(board.id) === Number(to.board.id)) {
    emitToBoard(
      board.id,
      "movedCard",
      { cardId: card.id, fromAreaId: area.id, toAreaId: to.area.id, newIndex: at, boardId: board.id },
      broadcast,
    );
  } else {
    emitToBoard(board.id, "deletedCard", { boardId: board.id, card }, broadcast);
    emitToBoard(to.board.id, "addCard", { boardId: to.board.id, card: moved }, broadcast);
  }
  return { card: moved, index: at };
}

/** A card to another position in its own area. Returns where it ended up. */
export async function orderCard(
  db: any,
  { card, board }: { card: any; board: any },
  index: number,
  broadcast: boolean,
) {
  const at = await putCard(db, card.area, card.id, index);
  emitToBoard(
    board.id,
    "orderdCard",
    { cardId: card.id, areaId: card.area, newIndex: at, boardId: board.id },
    broadcast,
  );
  return at;
}

/**
 * Off the board and into the archive, keeping everything it has — comments,
 * files, history — so it can be put back exactly as it was. With `permanent`,
 * gone for good with everything that hung off it: the archive's own "delete".
 */
export async function archiveCard(
  db: any,
  { card, board }: { card: any; board: any },
  actorId: string,
  broadcast: boolean,
  permanent = false,
) {
  if (permanent) {
    await removeCardData(db, [Number(card.id)]);
    await db.execute("DELETE FROM cards WHERE id = ?", [card.id]);
  } else if (!card.archivedAt) {
    await db.execute(
      "UPDATE cards SET archivedAt = NOW() WHERE id = ? AND archivedAt IS NULL",
      [card.id],
    );
    await recordCardActivity(card.id, "archived", actorId);
  }
  // It has left the board, which is what every open board needs to know;
  // whether it was filed away or destroyed is not theirs to care about.
  emitToBoard(board.id, "deletedCard", { boardId: board.id, card }, broadcast);
  dispatchWebhooks({
    boardId: board.id,
    event: "card.deleted",
    actorUserId: actorId,
    card: serializeCard(card),
  });
}
