import { defineMcpTool } from "@nuxtjs/mcp-toolkit/server";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import {
  requireUserId,
  requireBoard,
  requireId,
  boardIdInput,
  serializeBoard,
  serializeArea,
  serializeCard,
} from "../../utils/mcpHelpers";

const db = setupDatabase();

export default defineMcpTool({
  name: "getBoardTree",
  title: "Get a board with its areas and cards",
  description:
    "Load an entire board in one call: the board, its areas in order, and each area's cards in order (with comment/attachment counts). Prefer this over calling listAreas + listCards repeatedly. Card `content` is Markdown; use listComments for a card's comments. Requires read access.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: { ...boardIdInput },
  inputExamples: [{ boardId: 1 }],
  handler: async ({ boardId, boardID }) => {
    const userId = requireUserId();
    const id = requireId(boardId, boardID, "boardId");
    const board = await requireBoard(id, userId, "read");

    const [areas]: any = await db.execute(
      "SELECT * FROM areas WHERE board = ? AND archivedAt IS NULL ORDER BY sort ASC",
      [id],
    );
    const [cards]: any = await db.execute(
      `SELECT c.*,
              (SELECT COUNT(*) FROM comments co WHERE co.card = c.id) AS commentCount,
              (SELECT COUNT(*) FROM attachments a WHERE a.card = c.id) AS attachmentCount
       FROM cards c
       WHERE c.archivedAt IS NULL
         AND c.area IN (SELECT id FROM areas WHERE board = ? AND archivedAt IS NULL)
       ORDER BY c.sort ASC`,
      [id],
    );

    const cardsByArea = new Map<number, any[]>();
    for (const card of cards) {
      if (!cardsByArea.has(card.area)) cardsByArea.set(card.area, []);
      cardsByArea.get(card.area)!.push(serializeCard(card));
    }

    return jsonResult({
      board: serializeBoard(board),
      areas: areas.map((area: any) => ({
        ...serializeArea(area),
        cards: cardsByArea.get(area.id) || [],
      })),
    });
  },
});
