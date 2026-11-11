import { z } from "zod";
import { defineMcpTool } from "@nuxtjs/mcp-toolkit/server";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { createArea } from "../../utils/areas";
import {
  requireUserId,
  requireWriteAccess,
  requireBoard,
  requireId,
  boardIdInput,
  serializeArea,
} from "../../utils/mcpHelpers";

const db = setupDatabase();

export default defineMcpTool({
  name: "createArea",
  title: "Create an area",
  description:
    "Add an area (column/list) to the end of a board. Needs edit access to the board.",
  annotations: { readOnlyHint: false, openWorldHint: false },
  inputSchema: {
    ...boardIdInput,
    name: z.string().min(1).describe("The area name (e.g. 'Backlog', 'Done')."),
  },
  inputExamples: [{ boardId: 1, name: "In Progress" }],
  handler: async ({ boardId, boardID, name }) => {
    const userId = requireUserId();
    requireWriteAccess();
    const bid = requireId(boardId, boardID, "boardId");
    await requireBoard(bid, userId, "edit");
    const area = await createArea(db, bid, name, true);
    return jsonResult({ area: serializeArea(area) });
  },
});
