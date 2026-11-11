import { readBody } from "h3";
import { removeBoardMember } from "../../utils/boardMembership";

// POST /api/data/leaveBoard  { boardId }
//
// Lets a collaborator remove themselves from a board they were invited to.
// An invitation grants access immediately and there is no accept step, so this
// is the only way out for someone who no longer wants a board on their
// dashboard. The owner is deliberately excluded: a board always has exactly one
// owner, so "leaving" it would orphan it — the owner deletes the board instead.
export default dataHandler({
  async POST({ event, db, userId, boardOf }) {
    const body = await readBody(event).catch(() => null);
    const { board } = await boardOf(
      positiveId(body?.boardId, "Invalid board id"),
      "read",
    );
    if (board.user === userId) fail(400, "OWNER_CANNOT_LEAVE");

    // Somebody who was never invited has nothing to leave — the same 404 as a
    // board that is not there, so board ids can't be probed.
    if (!(await removeBoardMember(db, board.id, userId))) {
      fail(404, "Resource not found");
    }

    // The people still on the board lose a face from its tile, and the leaver
    // loses the tile — so they are notified explicitly, being no longer a
    // member by the time the membership is read.
    await notifyDashboards(db, board.id, [userId]);
    await notifyBoardMembersChanged(board.id);
    await notifyDashboards(db, board.id);

    return { message: "Left board successfully" };
  },
});
