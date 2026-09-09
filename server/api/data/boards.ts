import { defineEventHandler, readBody, getQuery } from "h3";
import { setupDatabase } from "../../../app/lib/databaseSetup";

export default defineEventHandler(async (event) => {
  // Resolve the authenticated user (API key or session). Boards are
  // user-scoped (own or shared-with), so queries are filtered by this userId.
  const auth = await resolveUserId(event);
  if (!auth.ok) {
    event.res.statusCode = auth.status;
    return { error: auth.error };
  }
  const userId = auth.userId;

  // Read body for shared parameter
  const { shared } = await readBody(event);

  // HIGH FIX: Validate shared is boolean if present
  const isShared = shared === true || shared === "true";

  try {
    // Initialize database
    const db = setupDatabase();

    // Get all boards for the authenticated user
    let rows;
    if (isShared) {
      // Fetch boards shared with the authenticated user
      const [sharedRows] = await db.execute(
        `SELECT boards.*
         FROM boards
         LEFT JOIN invitations ON boards.id = invitations.board
         WHERE invitations.user = ? AND boards.archivedAt IS NULL`,
        [userId],
      );
      rows = sharedRows;
    } else {
      // Fetch the authenticated user's own boards
      const [ownRows] = await db.execute(
        "SELECT * FROM boards WHERE user = ? AND archivedAt IS NULL",
        [userId],
      );
      rows = ownRows;
    }

    // Enrich each board with its members (owner + invited users) so the
    // dashboard tiles can show collaborator avatars. Done in a couple of batch
    // queries rather than per-board to avoid an N+1. IDs are compared against
    // parameterised values (not column-to-column) to sidestep the cross-collation
    // mismatch between boards/invitations.user and user.id.
    const boardRows = rows as any[];
    if (boardRows.length > 0) {
      const boardIds = boardRows.map((b) => b.id);
      const boardPlaceholders = boardIds.map(() => "?").join(",");
      const [inviteRows] = await db.execute(
        `SELECT board, \`user\` FROM invitations WHERE board IN (${boardPlaceholders})`,
        boardIds,
      );

      // Ordered member-id list per board: owner first, then invited users.
      const memberIdsByBoard = new Map<number, string[]>();
      for (const b of boardRows) {
        memberIdsByBoard.set(b.id, b.user ? [b.user] : []);
      }
      for (const inv of inviteRows as any[]) {
        const list = memberIdsByBoard.get(inv.board);
        if (list && inv.user && !list.includes(inv.user)) list.push(inv.user);
      }

      // Fetch every referenced member's profile in one query.
      const uniqueIds = [
        ...new Set(([] as string[]).concat(...memberIdsByBoard.values())),
      ];
      const usersById = new Map<string, any>();
      if (uniqueIds.length > 0) {
        const userPlaceholders = uniqueIds.map(() => "?").join(",");
        const [userRows] = await db.execute(
          `SELECT id, name, image FROM user WHERE id IN (${userPlaceholders})`,
          uniqueIds,
        );
        for (const u of userRows as any[]) usersById.set(u.id, u);
      }

      for (const b of boardRows) {
        const ids = memberIdsByBoard.get(b.id) || [];
        b.memberCount = ids.length;
        // Send at most four avatars; the tile shows a "+N" bubble beyond that.
        b.members = ids
          .slice(0, 4)
          .map((id) => usersById.get(id))
          .filter(Boolean);
      }

      // Per-board count of this user's unread notifications, so a tile can show
      // a pulsing badge when it has activity the user hasn't seen yet.
      const [notifRows] = await db.execute(
        `SELECT boardId, COUNT(*) AS c FROM notifications
         WHERE userId = ? AND isRead = 0 AND boardId IN (${boardPlaceholders})
         GROUP BY boardId`,
        [userId, ...boardIds],
      );
      const unreadByBoard = new Map<number, number>();
      for (const n of notifRows as any[]) {
        unreadByBoard.set(n.boardId, Number(n.c));
      }
      for (const b of boardRows) {
        b.unreadCount = unreadByBoard.get(b.id) || 0;
      }
    }

    return {
      boards: boardRows,
    };
  } catch (error) {
    logger.error("Database error:", error);
    event.res.statusCode = 500;
    return { error: "Internal server error" };
  }
});
