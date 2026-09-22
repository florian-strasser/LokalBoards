import { defineMcpTool } from "@nuxtjs/mcp-toolkit/server";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import {
  requireUserId,
  requireBoard,
  requireId,
  boardIdInput,
} from "../../utils/mcpHelpers";

const db = setupDatabase();

export default defineMcpTool({
  name: "listBoardMembers",
  title: "List board members",
  description:
    "List everyone with access to a board — the owner plus invited collaborators — with their userId, name, type ('human' or 'artificial') and role ('owner', 'edit' or 'read'). Use these userIds in assigneeIds when creating or updating cards.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: { ...boardIdInput },
  inputExamples: [{ boardId: 1 }],
  handler: async ({ boardId, boardID }) => {
    const userId = requireUserId();
    const id = requireId(boardId, boardID, "boardId");
    const board = await requireBoard(id, userId, "read");

    const [ownerRows]: any = await db.execute(
      "SELECT id, name, type FROM `user` WHERE id = ?",
      [board.user],
    );
    const members = ownerRows.map((u: any) => ({
      userId: u.id,
      name: u.name,
      type: u.type || "human",
      role: "owner",
    }));

    const [invited]: any = await db.execute(
      `SELECT u.id, u.name, u.type, inv.permission
       FROM invitations inv JOIN \`user\` u ON u.id = inv.user
       WHERE inv.board = ?`,
      [id],
    );
    for (const row of invited) {
      members.push({
        userId: row.id,
        name: row.name,
        type: row.type || "human",
        role: row.permission === "edit" ? "edit" : "read",
      });
    }

    return jsonResult({ members });
  },
});
