import { z } from "zod";
import { defineMcpTool } from "@nuxtjs/mcp-toolkit/server";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { updateBoard } from "../../utils/boards";
import {
  requireUserId,
  requireWriteAccess,
  requireBoard,
  requireId,
  boardIdInput,
  serializeBoard,
  McpError,
} from "../../utils/mcpHelpers";
import { normalizeBoardColor } from "../../../app/utils/boardColor";

const db = setupDatabase();

export default defineMcpTool({
  name: "updateBoard",
  title: "Update a board",
  description:
    "Change a board's settings (name, style, status, cover image, tile colour). Partial update — pass only what changes. Board settings can only be changed by the board's owner.",
  annotations: {
    readOnlyHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    ...boardIdInput,
    id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Deprecated alias for boardId."),
    name: z.string().min(1).optional().describe("New board name."),
    style: z.enum(["kanban", "todo", "mindmap"]).optional().describe("New layout."),
    status: z
      .enum(["private", "public"])
      .optional()
      .describe("New visibility."),
    image: z.string().optional().describe("New cover image URL ('' to clear)."),
    color: z
      .string()
      .optional()
      .describe(
        "New tile colour as a hex value, e.g. '#2563eb' ('' to clear). A cover image covers the tile, so setting a colour clears the image.",
      ),
  },
  inputExamples: [{ boardId: 1, status: "public" }],
  handler: async ({ boardId, boardID, id, name, style, status, image, color }) => {
    const userId = requireUserId();
    requireWriteAccess();
    const bid = requireId(boardId, boardID ?? id, "boardId");
    const board = await requireBoard(bid, userId, "edit");
    if (board.user !== userId) {
      throw new McpError(
        "FORBIDDEN",
        "Only the board owner can change board settings.",
      );
    }
    // An agent is told when its colour is not one, rather than finding the
    // board with no colour at all — which is how one would be stored.
    if (color !== undefined && color !== "" && normalizeBoardColor(color) === null) {
      throw new McpError(
        "VALIDATION",
        "color must be a hex colour such as '#2563eb', or '' to clear it.",
      );
    }

    const patch = {
      name,
      style,
      status,
      image: image === undefined ? undefined : image || null,
      color,
    };
    if (Object.values(patch).every((value) => value === undefined)) {
      throw new McpError("VALIDATION", "Provide at least one field to update.");
    }
    const updated = await updateBoard(db, board, patch, true);
    if (!updated) throw new McpError("NOT_FOUND", `No board with id ${bid}.`);
    return jsonResult({ board: serializeBoard(updated) });
  },
});
