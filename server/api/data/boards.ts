import { readBody } from "h3";
import { withTiles } from "../../utils/boardTiles";

export default dataHandler({
  // The caller's own boards, or — with `shared` — the boards shared with them.
  // There is no `userId` to pass: whose boards these are is the caller's, which
  // is what stops a key being pointed at somebody else's. Each comes dressed
  // for its tile: who is on it, and how much there is the caller has not seen.
  async POST({ event, db, userId }) {
    const body = await readBody(event).catch(() => null);
    const shared = body?.shared === true || body?.shared === "true";

    const [boards]: any = shared
      ? await db.execute(
          `SELECT boards.*
             FROM boards
             LEFT JOIN invitations ON boards.id = invitations.board
            WHERE invitations.user = ? AND boards.archivedAt IS NULL`,
          [userId],
        )
      : await db.execute(
          "SELECT * FROM boards WHERE user = ? AND archivedAt IS NULL",
          [userId],
        );

    return { boards: await withTiles(db, userId, boards) };
  },
});
