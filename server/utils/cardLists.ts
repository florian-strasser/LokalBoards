import { attachAssignees } from "./cardAssignees";
import { commentsOnCards } from "./comments";
import { escapeLike } from "./search";

// Cards many at a time: which ones a list or a search is after, and what the
// board draws on each of them, read in one query per kind rather than one per
// card.
//
// The REST list (`GET /api/data/cards`) and the MCP tools that list, find and
// fetch cards all choose their cards here, so a filter means the same thing
// whichever way it arrives. They used to write it out for themselves, and
// drifted: an agent searching for "100%" was shown every card that mentions
// 100.

export interface CardFilter {
  cardId?: number;
  areaId?: number;
  boardId?: number;
  /** Words in its name, its description or the name of one of its labels. */
  text?: string;
  /** Only the cards that are done, or only the open ones. */
  done?: boolean;
  /** Only the cards this person is on, alone or with others. */
  assigneeId?: string;
  /** Only the cards nobody is on. */
  unassigned?: boolean;
  /** Only the cards due before this moment. One that is not a date filters nothing. */
  dueBefore?: string | Date;
  /**
   * Leave out what is on an archived board as well. The board page still
   * opens an archived board from a link, and shows what is on it; an agent
   * has no business there.
   */
  openBoard?: boolean;
}

/**
 * The cards a filter describes, as conditions on `cards c` and the values for
 * their placeholders, for a query to put after its WHERE.
 */
export function cardFilter(filter: CardFilter): { where: string; params: unknown[] } {
  // An archived card is not on the board. Neither is one whose whole area was
  // archived — the area took its cards with it without marking each of them,
  // so that restoring it brings back exactly what was in it.
  const where = [
    "c.archivedAt IS NULL",
    filter.openBoard
      ? "EXISTS (SELECT 1 FROM areas fa JOIN boards fb ON fb.id = fa.board WHERE fa.id = c.area AND fa.archivedAt IS NULL AND fb.archivedAt IS NULL)"
      : "EXISTS (SELECT 1 FROM areas fa WHERE fa.id = c.area AND fa.archivedAt IS NULL)",
  ];
  const params: unknown[] = [];
  const add = (condition: string, ...values: unknown[]) => {
    where.push(condition);
    params.push(...values);
  };

  if (filter.cardId !== undefined) add("c.id = ?", filter.cardId);
  if (filter.areaId !== undefined) add("c.area = ?", filter.areaId);
  if (filter.boardId !== undefined) {
    add("EXISTS (SELECT 1 FROM areas fa WHERE fa.id = c.area AND fa.board = ?)", filter.boardId);
  }
  if (filter.text) {
    // A label is one of the words a card is findable by, the same as its name
    // and its description — searching for "Bug" should turn up the cards
    // marked Bug, not nothing. A `%` or `_` typed in means itself.
    const like = `%${escapeLike(filter.text)}%`;
    add(
      "(c.name LIKE ? ESCAPE '\\\\' OR c.content LIKE ? ESCAPE '\\\\' OR EXISTS (SELECT 1 FROM card_labels cl JOIN labels l ON l.id = cl.label WHERE cl.card = c.id AND l.name LIKE ? ESCAPE '\\\\'))",
      like,
      like,
      like,
    );
  }
  if (filter.done !== undefined) add("c.status = ?", filter.done ? 1 : 0);
  if (filter.unassigned) {
    add("NOT EXISTS (SELECT 1 FROM card_assignees ca WHERE ca.card = c.id)");
  }
  if (filter.assigneeId) {
    add(
      "EXISTS (SELECT 1 FROM card_assignees ca WHERE ca.card = c.id AND ca.user = ?)",
      filter.assigneeId,
    );
  }
  if (filter.dueBefore) {
    const before = new Date(filter.dueBefore);
    if (!Number.isNaN(before.getTime())) {
      add("c.dueDate IS NOT NULL AND c.dueDate < ?", before);
    }
  }
  return { where: where.join(" AND "), params };
}

// What a tile is drawn from, with its counts, so it can say how many comments
// and files a card has without anybody opening it.
const TILE = `c.id, c.area, c.name, c.content, c.status, c.sort, c.dueDate, c.repeatEvery, c.mapX, c.mapY,
  (SELECT COUNT(*) FROM comments co WHERE co.card = c.id) AS commentCount,
  (SELECT COUNT(*) FROM attachments att WHERE att.card = c.id) AS attachmentCount`;

/** The cards a filter describes, in the board's order, with the people on them. */
export async function cardsMatching(db: any, filter: CardFilter) {
  const { where, params } = cardFilter(filter);
  const [rows]: any = await db.execute(
    `SELECT ${TILE} FROM cards c WHERE ${where} ORDER BY c.sort ASC, c.id ASC`,
    params,
  );
  return attachAssignees(db, rows);
}

async function rowsFor(db: any, sql: string, cardIds: number[]): Promise<any[]> {
  if (!cardIds.length) return [];
  const [rows]: any = await db.query(sql, [cardIds]);
  return rows;
}

// Rows that each name a card, gathered under it.
function byCard<T>(rows: any[], value: (row: any) => T): Map<number, T[]> {
  const grouped = new Map<number, T[]>();
  for (const row of rows) {
    const list = grouped.get(row.card) ?? [];
    list.push(value(row));
    grouped.set(row.card, list);
  }
  return grouped;
}

/** The labels each of these cards wears, in the board's order of them, by card. */
export async function labelsOn(db: any, cardIds: number[]) {
  const rows = await rowsFor(
    db,
    "SELECT cl.card, l.id, l.name FROM card_labels cl JOIN labels l ON l.id = cl.label WHERE cl.card IN (?) ORDER BY l.sort ASC, l.id ASC",
    cardIds,
  );
  return byCard(rows, (row) => ({ id: row.id, name: row.name }));
}

/**
 * These cards with what the card window opens on, so a board that has loaded
 * them can open any one without asking again: its comments, its files, its
 * reminders and its labels. Of a file only its name, type and size come —
 * the bytes are fetched when somebody downloads it.
 */
export async function withCardDetails(db: any, cards: any[]) {
  const ids = cards.map((card) => card.id);
  const comments = await commentsOnCards(db, ids);
  const attachments = byCard(
    await rowsFor(
      db,
      "SELECT id, card, filename, filetype, filesize FROM attachments WHERE card IN (?)",
      ids,
    ),
    (row) => ({ id: row.id, filename: row.filename, filetype: row.filetype, filesize: row.filesize }),
  );
  const reminders = byCard(
    await rowsFor(
      db,
      "SELECT card, minutesBefore FROM card_reminders WHERE card IN (?) ORDER BY minutesBefore ASC",
      ids,
    ),
    (row) => row.minutesBefore,
  );
  const labels = await labelsOn(db, ids);

  for (const card of cards) {
    card.status = !!card.status;
    card.comments = comments.get(card.id) ?? [];
    card.attachments = attachments.get(card.id) ?? [];
    card.reminders = reminders.get(card.id) ?? [];
    card.labels = labels.get(card.id) ?? [];
  }
  return cards;
}
