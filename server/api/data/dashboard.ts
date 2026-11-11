import { withTiles } from "../../utils/boardTiles";

// The unified dashboard: every board the caller can see (owned and shared) in
// one list, each carrying the caller's own placement (which group, what
// position) plus the caller's groups. The frontend arranges boards by group and
// sort; a board with no placement row yet comes back ungrouped (groupId null,
// sort null) and is shown in a stable default order.
export default dataHandler({
  async GET({ db, userId }) {
    // Owned + shared boards in one query, with this user's placement joined on.
    // `owned` lets the tile show a "shared" badge for boards the caller doesn't
    // own. Newest-first is the default order for boards not yet placed.
    const [boards]: any = await db.query(
      `SELECT b.*, (b.user = ?) AS owned, bp.\`group\` AS groupId, bp.sort AS placementSort
         FROM boards b
         LEFT JOIN board_placements bp ON bp.board = b.id AND bp.user = ?
        WHERE b.archivedAt IS NULL
          AND (b.user = ?
               OR b.id IN (SELECT board FROM invitations WHERE user = ?))
        ORDER BY b.id DESC`,
      [userId, userId, userId, userId],
    );

    const [groups]: any = await db.execute(
      "SELECT id, name, sort, collapsed FROM `board_groups` WHERE `user` = ? ORDER BY sort, id",
      [userId],
    );

    await withTiles(db, userId, boards);
    for (const board of boards) {
      board.owned = !!board.owned;
      board.groupId = board.groupId === null ? null : Number(board.groupId);
      board.placementSort =
        board.placementSort === null ? null : Number(board.placementSort);
    }

    return {
      groups: groups.map((group: any) => ({
        id: group.id,
        name: group.name,
        sort: group.sort,
        collapsed: !!group.collapsed,
      })),
      boards,
    };
  },
});
