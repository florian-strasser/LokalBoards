import { defineMcpTool } from "@nuxtjs/mcp-toolkit/server";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import {
  requireUserId,
  requireBoard,
  requireId,
  boardIdInput,
  serializeArea,
} from "../../utils/mcpHelpers";

const db = setupDatabase();

export default defineMcpTool({
  name: "listAreas",
  title: "List areas",
  description:
    "List a board's areas (the columns/lists), in order. Returns id, boardId, name and position for each. Requires read access to the board. Prefer getBoardTree if you also want the cards.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: { ...boardIdInput },
  inputExamples: [{ boardId: 1 }],
  handler: async ({ boardId, boardID }) => {
    const userId = requireUserId();
    const id = requireId(boardId, boardID, "boardId");
    await requireBoard(id, userId, "read");
    const [rows]: any = await db.execute(
      "SELECT * FROM areas WHERE board = ? AND archivedAt IS NULL ORDER BY sort ASC",
      [id],
    );
    return jsonResult({ areas: rows.map(serializeArea) });
  },
});
