import { z } from "zod";
import { defineMcpTool } from "@nuxtjs/mcp-toolkit/server";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { getServerSocket } from "../../utils/socket";
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

    const fields: string[] = [];
    const values: any[] = [];
    if (name !== undefined) {
      fields.push("name = ?");
      values.push(name);
    }
    if (style !== undefined) {
      fields.push("style = ?");
      values.push(style);
    }
    if (status !== undefined) {
      fields.push("status = ?");
      values.push(status);
    }
    if (image !== undefined) {
      fields.push("image = ?");
      values.push(image === "" ? null : image);
      // The image sits on top of the colour, so keeping both would leave a
      // colour that can never be seen.
      if (image !== "" && color === undefined) {
        fields.push("color = ?");
        values.push(null);
      }
    }
    if (color !== undefined) {
      const normalized = normalizeBoardColor(color);
      if (color !== "" && normalized === null) {
        throw new McpError(
          "VALIDATION",
          "color must be a hex colour such as '#2563eb', or '' to clear it.",
        );
      }
      fields.push("color = ?");
      values.push(normalized);
      if (normalized && image === undefined) {
        fields.push("image = ?");
        values.push(null);
      }
    }
    if (fields.length === 0) {
      throw new McpError("VALIDATION", "Provide at least one field to update.");
    }

    await db.execute(`UPDATE boards SET ${fields.join(", ")} WHERE id = ?`, [
      ...values,
      bid,
    ]);
    const [rows]: any = await db.execute("SELECT * FROM boards WHERE id = ?", [
      bid,
    ]);
    const updated = rows[0];

    const serverSocket = getServerSocket();
    if (serverSocket) {
      serverSocket.to(`board-${bid}`).emit("updateBoard", {
        boardID: bid,
        boardName: updated.name,
        boardStatus: updated.status,
        boardStyle: updated.style,
      });
    }

    return jsonResult({ board: serializeBoard(updated) });
  },
});
