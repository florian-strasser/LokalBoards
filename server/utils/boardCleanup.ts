import { removeCardData } from "./cardCleanup";

// Removing a board or an area for good.
//
// Extracted from the endpoints that used to hold it inline, because there are
// now two ways to reach it: somebody pressing the bin in the archive, and the
// retention sweep emptying the archive on its own. Two copies of "everything a
// board owns" would drift, and the half that drifted would leak rows and files
// nobody can see any more.
//
// `removeCardData` does the rest of the work for the cards themselves — their
// comments, attachments and the files behind them, reminders, activity,
// notifications, and any label left wearing nothing.

/**
 * An area and every card in it.
 *
 * The card ids are read first: once the cards are gone there is no way to find
 * what belonged to them.
 */
export async function removeAreaCompletely(db: any, areaId: number): Promise<void> {
  const [rows]: any = await db.execute(
    "SELECT `id` FROM `cards` WHERE `area` = ?",
    [areaId],
  );
  await removeCardData(
    db,
    (rows as any[]).map((row) => Number(row.id)),
  );
  await db.execute("DELETE FROM `cards` WHERE `area` = ?", [areaId]);
  await db.execute("DELETE FROM `areas` WHERE `id` = ?", [areaId]);
}

/**
 * A board and everything on it: its areas, its cards and all they own, its
 * invitations, webhooks, dashboard placements, notifications and labels.
 *
 * Returns false when the board was already gone, so a caller racing another
 * deletion can tell.
 */
export async function removeBoardCompletely(db: any, boardId: number): Promise<boolean> {
  const [cardRows]: any = await db.execute(
    "SELECT `id` FROM `cards` WHERE `area` IN (SELECT `id` FROM `areas` WHERE `board` = ?)",
    [boardId],
  );

  await db.execute("DELETE FROM invitations WHERE board = ?", [boardId]);
  await db.execute("DELETE FROM `webhooks` WHERE board = ?", [boardId]);
  await db.execute("DELETE FROM `board_placements` WHERE board = ?", [boardId]);
  await db.execute("DELETE FROM notifications WHERE boardId = ?", [boardId]);

  await removeCardData(
    db,
    (cardRows as any[]).map((row) => Number(row.id)),
  );

  await db.execute(
    "DELETE FROM cards WHERE area IN (SELECT id FROM areas WHERE board = ?)",
    [boardId],
  );
  await db.execute("DELETE FROM areas WHERE board = ?", [boardId]);
  // The board's own labels. The assignments themselves went with the cards.
  await db.execute("DELETE FROM `labels` WHERE `board` = ?", [boardId]);

  const [result]: any = await db.execute("DELETE FROM boards WHERE id = ?", [
    boardId,
  ]);
  return result.affectedRows > 0;
}
