import { defineMcpTool } from "@nuxtjs/mcp-toolkit/server";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { requireUserId, serializeBoard } from "../../utils/mcpHelpers";

const db = setupDatabase();

export default defineMcpTool({
  name: "listBoards",
  title: "List boards",
  description:
    "List every board the current user can access — boards they own plus boards shared with them via an invitation. Returns each board's id, name, style ('kanban' or 'todo'), status ('private' or 'public') and ownerId. Start here to discover board ids, then call getBoardTree to load a board's areas and cards.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async () => {
    const userId = requireUserId();
    const [rows]: any = await db.execute(
      `SELECT DISTINCT boards.* FROM boards
       LEFT JOIN invitations ON boards.id = invitations.board
       WHERE boards.archivedAt IS NULL
         AND (boards.user = ? OR invitations.user = ?)
       ORDER BY boards.id`,
      [userId, userId],
    );
    return jsonResult({ boards: rows.map(serializeBoard) });
  },
});
