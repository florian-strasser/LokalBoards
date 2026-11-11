import { defineMcpTool } from "@nuxtjs/mcp-toolkit/server";
import {
  requireUserId,
  requireBoard,
  requireId,
  boardIdInput,
  serializeBoard,
} from "../../utils/mcpHelpers";

export default defineMcpTool({
  name: "getBoard",
  title: "Get a board",
  description:
    "Get a single board by id: name, style ('kanban'|'todo'), status ('private'|'public') and ownerId. To also load the board's areas and cards, call getBoardTree instead.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: { ...boardIdInput },
  inputExamples: [{ boardId: 1 }],
  handler: async ({ boardId, boardID }) => {
    const userId = requireUserId();
    const id = requireId(boardId, boardID, "boardId");
    const board = await requireBoard(id, userId, "read");
    return jsonResult({ board: serializeBoard(board) });
  },
});
