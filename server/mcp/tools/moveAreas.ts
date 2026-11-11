import { z } from "zod";
import { defineMcpTool } from "@nuxtjs/mcp-toolkit/server";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { orderAreas } from "../../utils/areas";
import {
  requireUserId,
  requireWriteAccess,
  requireBoard,
  requireId,
  boardIdInput,
  serializeArea,
  McpError,
} from "../../utils/mcpHelpers";

const db = setupDatabase();

export default defineMcpTool({
  name: "moveAreas",
  title: "Reorder areas",
  description:
    "Set the left-to-right order of a board's areas. Pass the area ids in the desired order (they'll be numbered 0,1,2,…). Every id must belong to the board. Needs edit access.",
  annotations: {
    readOnlyHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    ...boardIdInput,
    areaIds: z
      .array(z.number().int().positive())
      .optional()
      .describe("The area ids in the new order."),
    areas: z
      .array(z.object({ id: z.number().int().positive() }))
      .optional()
      .describe("Deprecated alias: array of { id } in the new order."),
  },
  inputExamples: [{ boardId: 1, areaIds: [3, 1, 2] }],
  handler: async ({ boardId, boardID, areaIds, areas }) => {
    const userId = requireUserId();
    requireWriteAccess();
    const bid = requireId(boardId, boardID, "boardId");
    await requireBoard(bid, userId, "edit");
    const ids = (areaIds ?? (areas || []).map((a: any) => a.id)).map(Number);
    if (!ids.length) {
      throw new McpError("VALIDATION", "Provide areaIds in the new order.");
    }
    const ordered = await orderAreas(db, bid, ids, true);
    if (!ordered) {
      throw new McpError("VALIDATION", "Every area id must belong to the board.");
    }
    return jsonResult({ areas: ordered.map(serializeArea) });
  },
});
