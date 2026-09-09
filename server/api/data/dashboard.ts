import { defineEventHandler } from "h3";
import { setupDatabase } from "../../../app/lib/databaseSetup";

// The unified dashboard: every board the caller can see (owned and shared) in
// one list, each carrying the caller's own placement (which group, what
// position) plus the caller's groups. The frontend arranges boards by group and
// sort; a board with no placement row yet comes back ungrouped (groupId null,
// sort null) and is shown in a stable default order.
export default defineEventHandler(async (event) => {
  const auth = await resolveUserId(event);
  if (!auth.ok) {
    event.res.statusCode = auth.status;
    return { error: auth.error };
  }
  const userId = auth.userId;
  const db = setupDatabase();

  try {
    // Owned + shared boards in one query, with this user's placement joined on.
    // `owned` lets the tile show a "shared" badge for boards the caller doesn't
    // own. Newest-first is the default order for boards not yet placed.
    const [rows]: any = await db.query(
      `SELECT b.*, (b.user = ?) AS owned, bp.\`group\` AS groupId, bp.sort AS placementSort
         FROM boards b
         LEFT JOIN board_placements bp ON bp.board = b.id AND bp.user = ?
        WHERE b.archivedAt IS NULL
          AND (b.user = ?
               OR b.id IN (SELECT board FROM invitations WHERE user = ?))
        ORDER BY b.id DESC`,
      [userId, userId, userId, userId],
    );
    const boards = rows as any[];

    const [groupRows]: any = await db.execute(
      "SELECT id, name, sort, collapsed FROM `board_groups` WHERE `user` = ? ORDER BY sort, id",
      [userId],
    );

    if (boards.length > 0) {
      const boardIds = boards.map((b) => b.id);
      const ph = boardIds.map(() => "?").join(",");

      // Member avatars (owner first, then invited), same enrichment the old
      // boards endpoint did — batched to avoid an N+1.
      const [inviteRows]: any = await db.execute(
        `SELECT board, \`user\` FROM invitations WHERE board IN (${ph})`,
        boardIds,
      );
      const memberIdsByBoard = new Map<number, string[]>();
      for (const b of boards) memberIdsByBoard.set(b.id, b.user ? [b.user] : []);
      for (const inv of inviteRows) {
        const list = memberIdsByBoard.get(inv.board);
        if (list && inv.user && !list.includes(inv.user)) list.push(inv.user);
      }
      const uniqueIds = [
        ...new Set(([] as string[]).concat(...memberIdsByBoard.values())),
      ];
      const usersById = new Map<string, any>();
      if (uniqueIds.length > 0) {
        const uph = uniqueIds.map(() => "?").join(",");
        const [userRows]: any = await db.execute(
          `SELECT id, name, image FROM user WHERE id IN (${uph})`,
          uniqueIds,
        );
        for (const u of userRows) usersById.set(u.id, u);
      }

      const [notifRows]: any = await db.execute(
        `SELECT boardId, COUNT(*) AS c FROM notifications
          WHERE userId = ? AND isRead = 0 AND boardId IN (${ph})
          GROUP BY boardId`,
        [userId, ...boardIds],
      );
      const unreadByBoard = new Map<number, number>();
      for (const n of notifRows) unreadByBoard.set(n.boardId, Number(n.c));

      for (const b of boards) {
        const ids = memberIdsByBoard.get(b.id) || [];
        b.memberCount = ids.length;
        b.members = ids
          .slice(0, 4)
          .map((id) => usersById.get(id))
          .filter(Boolean);
        b.unreadCount = unreadByBoard.get(b.id) || 0;
        b.owned = !!b.owned;
        b.groupId = b.groupId === null ? null : Number(b.groupId);
        b.placementSort = b.placementSort === null ? null : Number(b.placementSort);
      }
    }

    return {
      groups: groupRows.map((g: any) => ({
        id: g.id,
        name: g.name,
        sort: g.sort,
        collapsed: !!g.collapsed,
      })),
      boards,
    };
  } catch (error) {
    logger.error("Dashboard fetch error:", error);
    event.res.statusCode = 500;
    return { error: "Internal server error" };
  }
});
