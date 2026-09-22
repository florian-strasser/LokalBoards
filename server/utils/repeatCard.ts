import { recordCardActivity } from "./cardActivity";
import { attachAssignees, copyCardAssignees } from "./cardAssignees";
import { nextCardSort } from "./cardPositions";
import { isRepeatEvery, nextOccurrence, untickChecklist } from "./repeat";
import { getServerSocket } from "./socket";
import { dispatchWebhooks } from "./webhooks";

// The moment a repeating card is marked done: the next one goes on the board.
//
// Called by everything that can mark a card done — the dialog, the REST API and
// the MCP tools — after the card has been saved as done. Anything that is not a
// repeating card is left alone and gets `null` back.
//
// The series moves to the new card rather than being copied onto it. The card
// that was done keeps what it was, as the record of that week, but no longer
// repeats — so ticking it off, on again and off again cannot put a second next
// card on the board. Taking the rhythm off it is also how two requests racing
// to finish the same card are kept apart: only the one whose update actually
// changed the row goes on to create anything.
export async function repeatCard(
  db: any,
  cardId: number,
  actorId: string,
): Promise<any | null> {
  const [[card]]: any = await db.execute("SELECT * FROM cards WHERE id = ?", [
    cardId,
  ]);
  if (!card || !isRepeatEvery(card.repeatEvery) || !card.dueDate) return null;

  const [handedOn]: any = await db.execute(
    "UPDATE cards SET repeatEvery = NULL, repeatAnchor = NULL, repeatArea = NULL WHERE id = ? AND repeatEvery IS NOT NULL",
    [cardId],
  );
  if (!handedOn.affectedRows) return null;

  // The column the series was set up in, if it is still a live column of the
  // same board; otherwise the column the card is in now.
  const [[board]]: any = await db.execute(
    "SELECT b.id, b.name FROM boards b JOIN areas a ON a.board = b.id WHERE a.id = ?",
    [card.area],
  );
  let area = Number(card.area);
  if (card.repeatArea != null && Number(card.repeatArea) !== area) {
    const [[home]]: any = await db.execute(
      "SELECT id FROM areas WHERE id = ? AND board = ? AND archivedAt IS NULL",
      [card.repeatArea, board?.id],
    );
    if (home) area = Number(home.id);
  }

  const due = new Date(card.dueDate);
  const anchor = card.repeatAnchor ? new Date(card.repeatAnchor) : due;
  const after = new Date(Math.max(due.getTime(), Date.now()));
  const nextDue = nextOccurrence(anchor, card.repeatEvery, after);

  const [inserted]: any = await db.execute(
    "INSERT INTO cards (area, name, content, status, sort, dueDate, repeatEvery, repeatAnchor, repeatArea) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)",
    [
      area,
      card.name,
      untickChecklist(card.content || ""),
      await nextCardSort(db, area),
      nextDue,
      card.repeatEvery,
      anchor,
      area,
    ],
  );
  const nextId = Number(inserted.insertId);

  // What the card says about itself comes along: who is on it, its labels and
  // when to be reminded. The conversation and the files stay with the card
  // they belong to.
  await copyCardAssignees(db, cardId, nextId);
  await db.execute(
    "INSERT INTO `card_labels` (`card`, `label`) SELECT ?, `label` FROM `card_labels` WHERE `card` = ?",
    [nextId, cardId],
  );
  await db.execute(
    "INSERT INTO card_reminders (card, minutesBefore, notified) SELECT ?, minutesBefore, 0 FROM card_reminders WHERE card = ?",
    [nextId, cardId],
  );

  await recordCardActivity(nextId, "created", actorId, {
    repeatedFrom: cardId,
  });
  await recordCardActivity(cardId, "repeated", actorId, {
    nextId,
    dueDate: nextDue.toISOString(),
  });

  // The shape the board draws a card from, labels included, so it can go
  // straight into the column.
  const [rows]: any = await db.execute(
    "SELECT c.id, c.area, c.name, c.content, c.status, c.sort, c.dueDate, c.repeatEvery, 0 AS commentCount, 0 AS attachmentCount FROM cards c WHERE c.id = ?",
    [nextId],
  );
  const [next] = await attachAssignees(db, rows);
  const [labels]: any = await db.execute(
    "SELECT l.id, l.name FROM `card_labels` cl JOIN `labels` l ON l.id = cl.label WHERE cl.card = ? ORDER BY l.sort ASC, l.id ASC",
    [nextId],
  );
  const [reminders]: any = await db.execute(
    "SELECT minutesBefore FROM card_reminders WHERE card = ? ORDER BY minutesBefore ASC",
    [nextId],
  );
  next.status = false;
  next.labels = labels;
  next.reminders = reminders.map((row: any) => row.minutesBefore);

  // Nobody asked for this card, the browser included, so the server tells
  // every open board — the person who ticked the box among them. A server
  // without its socket (a script, a test) still gets the card.
  try {
    getServerSocket()
      .to(`board-${board?.id}`)
      .emit("addCard", { boardId: board?.id, card: next });
  } catch {}

  dispatchWebhooks({
    boardId: board?.id,
    event: "card.created",
    actorUserId: actorId,
    card: { id: next.id, name: next.name, areaId: next.area },
  });

  return next;
}
