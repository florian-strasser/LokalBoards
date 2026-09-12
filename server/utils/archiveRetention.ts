import { removeAreaCompletely, removeBoardCompletely } from "./boardCleanup";
import { removeCardData } from "./cardCleanup";

// Emptying the archive.
//
// Archiving replaced deleting, which means nothing is ever destroyed unless
// somebody goes looking for the bin — and on an instance that has been running
// a while that is a pile of cards, their attachments and the files behind them,
// kept for ever because nobody pressed a second button.
//
// So the archive empties itself. Thirty days is what a recycle bin usually
// keeps: long enough that an accident is recoverable well after it is noticed,
// short enough that the disk does not fill with work somebody threw away last
// year. It is configurable, and it can be turned off.

const DEFAULT_RETENTION_DAYS = 30;

/**
 * How long archived things are kept, in days. `0` keeps them for ever.
 *
 * `NUXT_ARCHIVE_RETENTION_DAYS` sets it. Anything unreadable falls back to the
 * default rather than to zero: a typo in an environment variable should not
 * quietly turn off the sweep, and it should certainly not quietly delete
 * everything.
 */
export function retentionDays(): number {
  const raw = process.env.NUXT_ARCHIVE_RETENTION_DAYS;
  if (raw === undefined || raw === null || raw === "") {
    return DEFAULT_RETENTION_DAYS;
  }
  const days = Number(raw);
  if (!Number.isFinite(days) || days < 0) return DEFAULT_RETENTION_DAYS;
  return Math.floor(days);
}

export interface PurgeResult {
  boards: number;
  areas: number;
  cards: number;
  retentionDays: number;
}

/**
 * Remove everything archived longer ago than the retention period.
 *
 * Boards first, then areas, then cards: a board takes its areas and their cards
 * with it, so doing it the other way round would be work repeated. What is left
 * at each step is only what was archived in its own right.
 *
 * Each is removed through the same code the archive's own bin uses, so what the
 * sweep destroys and what a person destroys are the same thing.
 */
export async function purgeExpiredArchives(db: any): Promise<PurgeResult> {
  const days = retentionDays();
  const result: PurgeResult = { boards: 0, areas: 0, cards: 0, retentionDays: days };
  if (days === 0) return result;

  const [boards]: any = await db.execute(
    "SELECT `id` FROM `boards` WHERE `archivedAt` IS NOT NULL AND `archivedAt` < DATE_SUB(NOW(), INTERVAL ? DAY)",
    [days],
  );
  for (const board of boards as any[]) {
    await removeBoardCompletely(db, Number(board.id));
    result.boards += 1;
  }

  const [areas]: any = await db.execute(
    "SELECT `id` FROM `areas` WHERE `archivedAt` IS NOT NULL AND `archivedAt` < DATE_SUB(NOW(), INTERVAL ? DAY)",
    [days],
  );
  for (const area of areas as any[]) {
    await removeAreaCompletely(db, Number(area.id));
    result.areas += 1;
  }

  const [cards]: any = await db.execute(
    "SELECT `id` FROM `cards` WHERE `archivedAt` IS NOT NULL AND `archivedAt` < DATE_SUB(NOW(), INTERVAL ? DAY)",
    [days],
  );
  const cardIds = (cards as any[]).map((row) => Number(row.id));
  if (cardIds.length) {
    await removeCardData(db, cardIds);
    await db.execute(
      `DELETE FROM \`cards\` WHERE \`id\` IN (${cardIds.map(() => "?").join(",")})`,
      cardIds,
    );
    result.cards = cardIds.length;
  }

  return result;
}
