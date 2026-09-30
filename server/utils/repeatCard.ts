import { recordCardActivity } from "./cardActivity";
import { attachAssignees, copyCardAssignees } from "./cardAssignees";
import { nextCardSort } from "./cardPositions";
import { isRepeatEvery, planNextCard, untickChecklist } from "./repeat";
import { getServerSocket } from "./socket";
import { dispatchWebhooks } from "./webhooks";

// The sweep that puts the next card of a repeating series on the board.
//
// It runs on a schedule (`server/tasks/repeat-cards.ts`, every five minutes)
// and once at startup, so a card that was due to appear while the instance was
// off appears as soon as it is back. Nobody has to do anything for it: the next
// card is made when the rhythm comes round, whether or not the one before it
// was marked done. What that means in practice is that a job nobody got to
// leaves an undone card behind and this week's card still arrives.
//
// The series moves to the new card rather than being copied onto it, and that
// move is also the lock: only the sweep whose UPDATE actually cleared the
// rhythm goes on to make anything, so two servers sharing one database — or a
// scheduled run overlapping the one at startup — cannot put the same card on
// the board twice.

// One card of a series, if it is still owed one. Returns the new card, or null
// when the card was not (or is no longer) a repeating card.
export async function repeatCard(
  db: any,
  cardId: number,
  actorId: string | null,
  now: Date = new Date(),
): Promise<any | null> {
  const [[card]]: any = await db.execute("SELECT * FROM cards WHERE id = ?", [
    cardId,
  ]);
  if (!card || !isRepeatEvery(card.repeatEvery)) return null;

  const [handedOn]: any = await db.execute(
    "UPDATE cards SET repeatEvery = NULL, repeatAnchor = NULL, repeatArea = NULL, repeatNext = NULL WHERE id = ? AND repeatEvery IS NOT NULL",
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

  const due = card.dueDate ? new Date(card.dueDate) : null;
  const anchor = card.repeatAnchor
    ? new Date(card.repeatAnchor)
    : (due ?? new Date(now.getTime()));
  const plan = planNextCard({ every: card.repeatEvery, anchor, due }, now);

  const [inserted]: any = await db.execute(
    "INSERT INTO cards (area, name, content, status, sort, dueDate, repeatEvery, repeatAnchor, repeatArea, repeatNext) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?)",
    [
      area,
      card.name,
      untickChecklist(card.content || ""),
      await nextCardSort(db, area),
      plan.due,
      card.repeatEvery,
      anchor,
      area,
      plan.repeatNext,
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
    dueDate: plan.due ? plan.due.toISOString() : null,
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

  // Nobody asked for this card, no browser and no person, so the server tells
  // every open board it appeared. A server without its socket (a script, a
  // test) still gets the card.
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

/**
 * Every series whose turn has come. Archived cards are passed over — a card
 * put away is not a series anybody is waiting on — and take their turn again
 * if they are restored.
 */
export async function repeatDueCards(
  db: any,
  now: Date = new Date(),
): Promise<{ created: number }> {
  const [rows]: any = await db.execute(
    "SELECT id FROM cards WHERE repeatEvery IS NOT NULL AND repeatNext IS NOT NULL AND repeatNext <= ? AND archivedAt IS NULL ORDER BY id ASC",
    [now],
  );
  let created = 0;
  for (const row of rows) {
    try {
      // No actor: nobody did this, the rhythm did. The card's history says so
      // by naming the instance rather than a person.
      if (await repeatCard(db, Number(row.id), null, now)) created++;
    } catch (error) {
      // One card that cannot be repeated — a column deleted underneath it, a
      // row another server took first — must not stop the rest of the sweep.
      logger.error(`Could not repeat card ${row.id}:`, error);
    }
  }
  return { created };
}
