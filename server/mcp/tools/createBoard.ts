import { z } from "zod";
import { defineMcpTool } from "@nuxtjs/mcp-toolkit/server";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { createBoard } from "../../utils/boards";
import {
  requireUserId,
  requireWriteAccess,
  serializeBoard,
} from "../../utils/mcpHelpers";

const db = setupDatabase();

export default defineMcpTool({
  name: "createBoard",
  title: "Create a board",
  description:
    "Create a new board owned by the current user. `style` defaults to 'kanban' (columns) — 'todo' is a single list. `status` defaults to 'private'; 'public' makes it read-only to anyone with the link. Use createArea to add columns, then createCard. To change an existing board use updateBoard.",
  annotations: { readOnlyHint: false, openWorldHint: false },
  inputSchema: {
    name: z.string().min(1).describe("The board name."),
    style: z
      .enum(["kanban", "todo", "mindmap"])
      .optional()
      .describe(
        "Layout: 'kanban' (default), 'todo' or 'mindmap' (areas and cards placed freely on a canvas).",
      ),
    status: z
      .enum(["private", "public"])
      .optional()
      .describe("'private' (default) or 'public'."),
    image: z.string().optional().describe("Optional cover image URL."),
    color: z
      .string()
      .optional()
      .describe(
        "Optional tile colour as a hex value, e.g. '#2563eb'. Ignored when a cover image is given, since the image covers the tile.",
      ),
  },
  inputExamples: [
    { name: "Product Roadmap" },
    { name: "Personal Tasks", style: "todo" },
  ],
  handler: async ({ name, style, status, image, color }) => {
    const userId = requireUserId();
    requireWriteAccess();
    const board = await createBoard(db, userId, {
      name,
      style: style || "kanban",
      status: status || "private",
      image: image || null,
      // The image covers the tile, so a colour beside it could never be seen.
      color: image ? null : color,
    }, true);
    return jsonResult({ board: serializeBoard(board) });
  },
});
