// What a board's tile shows besides the board itself: the faces of the people
// on it, and whether anything has happened there the caller has not seen yet.
// The dashboard, the API's list of boards and the search all draw that same
// tile, so they all ask here — for a whole list of boards at once, in a fixed
// handful of queries rather than a few per board.
//
// Ids are compared against parameterised values, never column to column:
// boards.user and invitations.user are utf8mb4_general_ci while user.id is
// utf8mb4_0900_ai_ci, and MySQL will not compare the two.

/** As many faces as a tile has room for; it shows "+N" for the rest. */
const FACES = 4;

export interface TileMembers {
  /** The first four — the owner, then the invited — each `id`, `name`, `image`. */
  members: any[];
  /** Everyone on the board, the owner included. */
  memberCount: number;
}

/** Who is on each board: its owner (`user`), then everyone invited to it. */
export async function tileMembers(
  db: any,
  boards: { id: number; user?: string | null }[],
): Promise<Map<number, TileMembers>> {
  const tiles = new Map<number, TileMembers>();
  if (!boards.length) return tiles;

  const [invited]: any = await db.query(
    "SELECT board, `user` FROM invitations WHERE board IN (?)",
    [boards.map((board) => board.id)],
  );
  const idsByBoard = new Map<number, string[]>();
  for (const board of boards) idsByBoard.set(board.id, board.user ? [board.user] : []);
  for (const row of invited) {
    const ids = idsByBoard.get(row.board);
    if (ids && row.user && !ids.includes(row.user)) ids.push(row.user);
  }

  // Only the faces a tile will show are worth looking up.
  const shown = [
    ...new Set([...idsByBoard.values()].flatMap((ids) => ids.slice(0, FACES))),
  ];
  const usersById = new Map<string, any>();
  if (shown.length) {
    const [users]: any = await db.query(
      "SELECT id, name, image FROM `user` WHERE id IN (?)",
      [shown],
    );
    for (const user of users) usersById.set(user.id, user);
  }

  for (const [boardId, ids] of idsByBoard) {
    tiles.set(boardId, {
      members: ids
        .slice(0, FACES)
        .map((id) => usersById.get(id))
        .filter(Boolean),
      memberCount: ids.length,
    });
  }
  return tiles;
}

/** How many of the caller's notifications about each board are still unread. */
export async function unreadCounts(
  db: any,
  userId: string,
  boardIds: number[],
): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  if (!boardIds.length) return counts;
  const [rows]: any = await db.query(
    "SELECT boardId, COUNT(*) AS c FROM notifications WHERE userId = ? AND isRead = 0 AND boardId IN (?) GROUP BY boardId",
    [userId, boardIds],
  );
  for (const row of rows) counts.set(row.boardId, Number(row.c));
  return counts;
}

/**
 * Board rows dressed for their tiles: each gets `memberCount`, `members` and
 * the caller's `unreadCount`, so a tile can show who is on the board and pulse
 * when there is something new on it.
 */
export async function withTiles(db: any, userId: string, boards: any[]) {
  const members = await tileMembers(db, boards);
  const unread = await unreadCounts(
    db,
    userId,
    boards.map((board) => board.id),
  );
  for (const board of boards) {
    const tile = members.get(board.id);
    board.memberCount = tile?.memberCount ?? 0;
    board.members = tile?.members ?? [];
    board.unreadCount = unread.get(board.id) || 0;
  }
  return boards;
}
