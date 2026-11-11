import { authorizeBoard, type AuthFailure } from "./auth";

// Who may do what to a board, an area or a card — decided once for the app,
// the REST API and the MCP server alike.
//
// Each loads the thing, and the board it belongs to, and decides the caller's
// access. A failure is returned rather than thrown, as the status and message
// it should be answered with, so each surface can say it in its own way: the
// REST API as a status code (`dataHandler` in endpoint.ts), MCP as an error
// code (mcpHelpers.ts). What is not there and what the caller may not see are
// the same 404, so ids cannot be probed; a board the caller can see but not
// change is a 403.

export type Level = "read" | "edit";

type Found<T> = AuthFailure | ({ ok: true; access: "read" | "edit" } & T);

const MISSING: AuthFailure = {
  ok: false,
  status: 404,
  error: "Resource not found",
};

export async function boardAccess(
  db: any,
  boardId: number | string,
  userId: string,
  level: Level,
): Promise<Found<{ board: any }>> {
  const [rows]: any = await db.execute("SELECT * FROM boards WHERE id = ?", [
    boardId,
  ]);
  const board = rows[0];
  if (!board) return MISSING;
  const decision = await authorizeBoard(db, board, userId, level);
  return decision.ok ? { ok: true, access: decision.access, board } : decision;
}

export async function areaAccess(
  db: any,
  areaId: number | string,
  userId: string,
  level: Level,
): Promise<Found<{ area: any; board: any }>> {
  const [rows]: any = await db.execute("SELECT * FROM areas WHERE id = ?", [
    areaId,
  ]);
  const area = rows[0];
  if (!area) return MISSING;
  const found = await boardAccess(db, area.board, userId, level);
  return found.ok ? { ...found, area } : found;
}

export async function cardAccess(
  db: any,
  cardId: number | string,
  userId: string,
  level: Level,
): Promise<Found<{ card: any; area: any; board: any }>> {
  const [rows]: any = await db.execute("SELECT * FROM cards WHERE id = ?", [
    cardId,
  ]);
  const card = rows[0];
  if (!card) return MISSING;
  const found = await areaAccess(db, card.area, userId, level);
  return found.ok ? { ...found, card } : found;
}
