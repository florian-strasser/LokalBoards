import { removeAreaCompletely } from "./boardCleanup";
import { emitToBoard } from "./socket";

// An area — a column of a board — made, renamed, put in order, archived or
// removed: the one way each is done, whether the app, the REST API or an agent
// over MCP asks for it. Access is the caller's to check first (see access.ts).
//
// `broadcast` is whether to tell whoever has the board open. A browser tells
// the others itself, so it is the API and MCP that ask for it.

async function areaById(db: any, id: number | string) {
  const [rows]: any = await db.execute("SELECT * FROM areas WHERE id = ?", [id]);
  return rows[0];
}

/** A new area at the end of the board. */
export async function createArea(
  db: any,
  boardId: number,
  name: string,
  broadcast: boolean,
) {
  const [[{ n }]]: any = await db.execute(
    "SELECT COUNT(*) AS n FROM areas WHERE board = ?",
    [boardId],
  );
  const [result]: any = await db.execute(
    "INSERT INTO areas (board, name, sort) VALUES (?, ?, ?)",
    [boardId, name, Number(n) + 1],
  );
  const area = await areaById(db, result.insertId);
  emitToBoard(boardId, "addArea", { area, boardId }, broadcast);
  return area;
}

export async function renameArea(
  db: any,
  area: any,
  name: string,
  broadcast: boolean,
) {
  await db.execute("UPDATE areas SET name = ? WHERE id = ?", [name, area.id]);
  const renamed = await areaById(db, area.id);
  emitToBoard(area.board, "updateArea", { area: renamed, boardId: area.board }, broadcast);
  return renamed;
}

/**
 * The board's areas in this order, or null — before anything is changed — when
 * an id is not one of the board's.
 */
export async function orderAreas(
  db: any,
  boardId: number,
  ids: number[],
  broadcast: boolean,
) {
  if (!ids.length) return null;
  const [belong]: any = await db.query(
    "SELECT id FROM areas WHERE board = ? AND id IN (?)",
    [boardId, ids],
  );
  if (belong.length !== new Set(ids).size) return null;
  for (const [sort, id] of ids.entries()) {
    await db.execute("UPDATE areas SET sort = ? WHERE id = ?", [sort, id]);
  }
  const [areas]: any = await db.execute(
    "SELECT * FROM areas WHERE board = ? ORDER BY sort",
    [boardId],
  );
  emitToBoard(boardId, "updateAreas", { areas, boardId }, broadcast);
  return areas;
}

/**
 * Into the archive, cards and all. The cards keep their own `archivedAt` as it
 * was: the board simply stops asking for the cards of an area that is not
 * there, so restoring the area brings back exactly what was in it, in order.
 * With `permanent`, gone for good — the archive's own "delete", and the same
 * call its nightly sweep makes.
 */
export async function archiveArea(
  db: any,
  area: any,
  broadcast: boolean,
  permanent = false,
) {
  if (permanent) {
    await removeAreaCompletely(db, Number(area.id));
  } else {
    await db.execute(
      "UPDATE areas SET archivedAt = NOW() WHERE id = ? AND archivedAt IS NULL",
      [area.id],
    );
  }
  emitToBoard(area.board, "deleteArea", { area: area.id, boardId: area.board }, broadcast);
}
