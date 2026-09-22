import { getBoardMemberIds } from "./boardMembers";

// Who a card is on.
//
// A card can be on several people — not every task is one person's — so the
// assignments are rows of their own in `card_assignees` rather than a column on
// the card. The order they were added in is kept, and the first of them is
// what the older, single-assignee fields of the API still report
// (`assignee`, `assigneeName`, `assigneeImage`, `assigneeType`), so an
// integration written before this keeps reading a sensible answer.
//
// Only members of the card's board can be on it: its owner and the people
// invited to it. Anyone else sent along is left off, the same way labels from
// another board are.

export interface Assignee {
  id: string;
  name: string | null;
  image: string | null;
  type: string | null;
}

/** What changed between two sets of people, in the order they were given. */
export function diffAssignees(
  before: string[],
  after: string[],
): { added: string[]; removed: string[] } {
  return {
    added: after.filter((id) => !before.includes(id)),
    removed: before.filter((id) => !after.includes(id)),
  };
}

/** The ids a caller sent, cleaned up: strings only, each once, in order. */
export function assigneeIdsFrom(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [];
  const ids: string[] = [];
  for (const entry of list) {
    const id = typeof entry === "string" ? entry.trim() : "";
    if (id && id.length <= 255 && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** A card with its people on it, and the first of them in the older fields. */
export function withAssignees(card: any, people: Assignee[]): any {
  const first = people[0] ?? null;
  return {
    ...card,
    assignees: people,
    assignee: first?.id ?? null,
    assigneeName: first?.name ?? null,
    assigneeImage: first?.image ?? null,
    assigneeType: first?.type ?? null,
  };
}

// ---------------------------------------------------------------------------
// Against the database.

export async function assigneesByCard(
  db: any,
  cardIds: number[],
): Promise<Map<number, Assignee[]>> {
  const ids = [...new Set(cardIds.map(Number))].filter((id) => id > 0);
  const byCard = new Map<number, Assignee[]>();
  if (!ids.length) return byCard;
  const [rows]: any = await db.execute(
    `SELECT ca.card, u.id, u.name, u.image, u.type
       FROM card_assignees ca JOIN \`user\` u ON u.id = ca.user
      WHERE ca.card IN (${ids.map(() => "?").join(",")})
      ORDER BY ca.id ASC`,
    ids,
  );
  for (const row of rows) {
    const list = byCard.get(Number(row.card)) ?? [];
    list.push({
      id: row.id,
      name: row.name ?? null,
      image: row.image ?? null,
      type: row.type ?? null,
    });
    byCard.set(Number(row.card), list);
  }
  return byCard;
}

/** The same cards, each with its people on it. */
export async function attachAssignees<T extends { id: number }>(
  db: any,
  cards: T[],
): Promise<any[]> {
  const byCard = await assigneesByCard(
    db,
    cards.map((card) => card.id),
  );
  return cards.map((card) =>
    withAssignees(card, byCard.get(Number(card.id)) ?? []),
  );
}

export async function assigneeIdsOf(db: any, cardId: number): Promise<string[]> {
  const [rows]: any = await db.execute(
    "SELECT user FROM card_assignees WHERE card = ? ORDER BY id ASC",
    [cardId],
  );
  return rows.map((row: any) => String(row.user));
}

/**
 * Everyone who can be put on a card of this board. Two questions rather than
 * one `UNION`: `boards.user` and `invitations.user` are stored with different
 * collations, and MySQL refuses to put the two in one column.
 */
export async function boardMemberIds(
  db: any,
  boardId: number,
): Promise<Set<string>> {
  return new Set(await getBoardMemberIds(db, boardId));
}

/**
 * Puts exactly these people on the card — members of `boardId` only — and says
 * who was added and who taken off. People who stay keep their place in the
 * order.
 */
export async function setCardAssignees(
  db: any,
  cardId: number,
  boardId: number,
  wanted: string[],
): Promise<{ added: string[]; removed: string[] }> {
  const members = await boardMemberIds(db, boardId);
  const next = wanted.filter((id) => members.has(id));
  const before = await assigneeIdsOf(db, cardId);
  const change = diffAssignees(before, next);
  for (const id of change.removed) {
    await db.execute("DELETE FROM card_assignees WHERE card = ? AND user = ?", [
      cardId,
      id,
    ]);
  }
  for (const id of change.added) {
    await db.execute(
      "INSERT IGNORE INTO card_assignees (card, user) VALUES (?, ?)",
      [cardId, id],
    );
  }
  return change;
}

/** The people of one card, put on another — a copy, or the next of a series. */
export async function copyCardAssignees(
  db: any,
  fromCardId: number,
  toCardId: number,
): Promise<void> {
  await db.execute(
    "INSERT IGNORE INTO card_assignees (card, user) SELECT ?, user FROM card_assignees WHERE card = ? ORDER BY id ASC",
    [toCardId, fromCardId],
  );
}

/**
 * Takes a card for `userId` if nobody is on it yet — the promise `claimCard`
 * makes to agents, that two of them never pick up the same work. A card you
 * are already on counts as yours.
 *
 * With the assignments in rows of their own, "nobody is on it" is a question
 * about rows that do not exist yet, which two requests could both answer "yes"
 * to at once. So the card's own row is locked for the length of the question:
 * the second request waits, then finds the first one's name there.
 */
export async function claimCardFor(
  db: any,
  cardId: number,
  userId: string,
): Promise<{ claimed: boolean; wasFree: boolean; holders: string[] }> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute("SELECT id FROM cards WHERE id = ? FOR UPDATE", [cardId]);
    const [rows]: any = await conn.execute(
      "SELECT user FROM card_assignees WHERE card = ? ORDER BY id ASC",
      [cardId],
    );
    const holders = rows.map((row: any) => String(row.user));
    const wasFree = holders.length === 0;
    if (wasFree) {
      await conn.execute(
        "INSERT INTO card_assignees (card, user) VALUES (?, ?)",
        [cardId, userId],
      );
      holders.push(userId);
    }
    await conn.commit();
    return { claimed: holders.includes(userId), wasFree, holders };
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}

/** Takes `userId` off the card. Whether they were on it. */
export async function releaseCardFor(
  db: any,
  cardId: number,
  userId: string,
): Promise<boolean> {
  const [result]: any = await db.execute(
    "DELETE FROM card_assignees WHERE card = ? AND user = ?",
    [cardId, userId],
  );
  return result.affectedRows > 0;
}
