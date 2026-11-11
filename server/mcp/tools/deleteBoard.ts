import { defineMcpTool } from "@nuxtjs/mcp-toolkit/server";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { archiveBoard } from "../../utils/boards";
import {
  requireUserId,
  requireWriteAccess,
  requireBoard,
  requireId,
  boardIdInput,
  McpError,
} from "../../utils/mcpHelpers";

const db = setupDatabase();

export default defineMcpTool({
  name: "deleteBoard",
  title: "Archive a board",
  description:
    "Archive a board with everything on it, as deleting one in the app does: it leaves the dashboard of everyone on it, keeps its areas, cards, comments, files and invitations, and can be restored from the owner's archive, where it is deleted for good after the retention period. Only the board's owner can do it.",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: { ...boardIdInput },
  inputExamples: [{ boardId: 1 }],
  handler: async ({ boardId, boardID }) => {
    const userId = requireUserId();
    requireWriteAccess();
    const bid = requireId(boardId, boardID, "boardId");
    const board = await requireBoard(bid, userId, "edit");
    if (board.user !== userId) {
      throw new McpError(
        "FORBIDDEN",
        "Only the board owner can delete a board.",
      );
    }
    // Into the archive, as in the app: an agent's mistake can be undone there.
    await archiveBoard(db, board, true);
    return jsonResult({ archived: true, boardId: bid });
  },
});
