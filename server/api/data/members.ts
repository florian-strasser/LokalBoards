import { getBoardMemberIds } from "../../utils/boardMembers";

// GET /api/data/members?boardId=123
// Returns the board's members (owner + invited users) for the assignee picker.
// Any user with read access to the board may list them.
export default dataHandler({
  async GET({ db, query, boardOf }) {
    const { board } = await boardOf(query.boardId, "read");
    // getBoardMemberIds uses separate queries, avoiding cross-collation column
    // comparisons (boards.user is utf8mb4_general_ci, user.id is 0900_ai_ci).
    const ids = await getBoardMemberIds(db, board.id);
    if (ids.length === 0) return { members: [] };

    const [members] = await db.query(
      "SELECT id, name, image FROM user WHERE id IN (?)",
      [ids],
    );
    return { members };
  },
});
