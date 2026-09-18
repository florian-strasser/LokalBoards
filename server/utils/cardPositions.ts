// Where cards go in a column.
//
// A column's order is the cards' `sort` numbers, and those numbers are never
// tidy. A card deleted for good — by hand, or by the archive's retention
// clean-up — takes its number with it and leaves a gap. An archived card keeps
// its number, so that restoring it brings it back where it was, but the board
// does not show it. So neither "how many cards there are" nor "the n-th card on
// the board" is ever a number in that column:
//
// - A new card goes after the highest number there is. Counting the cards and
//   adding one gave a number that, after a gap, a card further up already had,
//   and the new card was drawn in the middle of the column.
// - A card put somewhere is placed among the cards the board shows, which is
//   what the board counts in when it says where the card was dropped, and the
//   column is then numbered 0, 1, 2… in that order. Treating the drop position
//   as a number put the card a place too high for every gap or archived card
//   above it.

export interface ColumnCard {
  id: number;
  archived: boolean;
}

/**
 * The column's order after putting `cardId` at `index`, counted among the
 * cards that are not archived — as the board counts. Archived cards keep their
 * places relative to the others. With no index, or one past the end, the card
 * goes to the bottom.
 */
export function placeCard(
  column: ColumnCard[],
  cardId: number,
  index?: number | null,
): number[] {
  const rest = column.filter((card) => card.id !== cardId);
  const ids = rest.map((card) => card.id);
  const shown = rest.filter((card) => !card.archived);
  const at = index == null ? NaN : Math.max(0, Math.floor(Number(index)));
  if (!Number.isFinite(at) || at >= shown.length) return [...ids, cardId];
  ids.splice(ids.indexOf(shown[at].id), 0, cardId);
  return ids;
}

/** The column's order with `cardId` directly after `afterId`, or at the bottom
 *  when that card is not in it. */
export function placeCardAfter(
  column: ColumnCard[],
  cardId: number,
  afterId: number,
): number[] {
  const ids = column.map((card) => card.id).filter((id) => id !== cardId);
  const after = ids.indexOf(afterId);
  if (after === -1) return [...ids, cardId];
  ids.splice(after + 1, 0, cardId);
  return ids;
}

// ---------------------------------------------------------------------------
// The same, against the database.

const readColumn = async (db: any, areaId: number): Promise<ColumnCard[]> => {
  const [rows]: any = await db.execute(
    "SELECT id, archivedAt FROM cards WHERE area = ? ORDER BY sort ASC, id ASC",
    [areaId],
  );
  return rows.map((row: any) => ({
    id: Number(row.id),
    archived: row.archivedAt != null,
  }));
};

const writeOrder = async (db: any, ids: number[]) => {
  for (let i = 0; i < ids.length; i++) {
    await db.execute("UPDATE cards SET sort = ? WHERE id = ?", [i, ids[i]]);
  }
};

/** The number a card needs to be the last one in the column. */
export async function nextCardSort(db: any, areaId: number): Promise<number> {
  const [rows]: any = await db.execute(
    "SELECT COALESCE(MAX(sort), -1) + 1 AS next FROM cards WHERE area = ?",
    [areaId],
  );
  return Number(rows[0]?.next ?? 0);
}

/**
 * Puts a card into a column at a position the board gave — its own column or
 * another one — and numbers the column afresh. Moving it out of another column
 * leaves a gap there, which is harmless now; the caller renumbers that one if
 * it wants it tidy.
 *
 * Returns where the card ended up, counted the way the board counts, for
 * telling the boards that are open.
 */
export async function putCard(
  db: any,
  areaId: number,
  cardId: number,
  index?: number | null,
): Promise<number> {
  const column = await readColumn(db, Number(areaId));
  const order = placeCard(column, Number(cardId), index);
  await db.execute("UPDATE cards SET area = ? WHERE id = ?", [
    Number(areaId),
    Number(cardId),
  ]);
  await writeOrder(db, order);

  const archived = new Set(
    column.filter((card) => card.archived).map((card) => card.id),
  );
  return order
    .slice(0, order.indexOf(Number(cardId)))
    .filter((id) => !archived.has(id)).length;
}

/** Puts a card directly after another one in the same column. */
export async function putCardAfter(
  db: any,
  areaId: number,
  cardId: number,
  afterId: number,
): Promise<void> {
  const column = await readColumn(db, Number(areaId));
  await writeOrder(db, placeCardAfter(column, Number(cardId), Number(afterId)));
}

/** Numbers a column 0, 1, 2… in the order it already has. */
export async function renumberColumn(db: any, areaId: number): Promise<void> {
  const column = await readColumn(db, Number(areaId));
  await writeOrder(
    db,
    column.map((card) => card.id),
  );
}
