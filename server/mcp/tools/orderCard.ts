import { z } from "zod";
import { defineMcpTool } from "@nuxtjs/mcp-toolkit/server";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { attachAssignees } from "../../utils/cardAssignees";
import { getServerSocket } from "../../utils/socket";
import {
  requireUserId,
  requireWriteAccess,
  requireArea,
  requireId,
  areaIdInput,
  serializeCard,
  McpError,
} from "../../utils/mcpHelpers";

const db = setupDatabase();

export default defineMcpTool({
  name: "orderCard",
  title: "Reorder cards in an area",
  description:
    "Set the order of cards within a single area. Pass the card ids with their new 0-based sort values; every id must belong to the area. To move a card to a different area use moveCard instead. Needs edit access.",
  annotations: {
    readOnlyHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    ...areaIdInput,
    cardOrders: z
      .array(
        z.object({
          cardId: z
            .number()
            .int()
            .positive()
            .describe("A card id in this area."),
          sort: z.number().int().min(0).describe("Its new 0-based position."),
        }),
      )
      .min(1)
      .describe("Card ids paired with their new sort values."),
  },
  inputExamples: [
    {
      areaId: 1,
      cardOrders: [
        { cardId: 3, sort: 0 },
        { cardId: 1, sort: 1 },
      ],
    },
  ],
  handler: async ({ areaId, areaID, cardOrders }) => {
    const userId = requireUserId();
    requireWriteAccess();
    const id = requireId(areaId, areaID, "areaId");
    const { board } = await requireArea(id, userId, "edit");

    const cardIds = cardOrders.map((o: any) => o.cardId);
    const placeholders = cardIds.map(() => "?").join(",");
    const [belong]: any = await db.execute(
      `SELECT id FROM cards WHERE id IN (${placeholders}) AND area = ?`,
      [...cardIds, id],
    );
    if (belong.length !== cardOrders.length) {
      throw new McpError(
        "VALIDATION",
        "Every cardId must belong to the given area.",
      );
    }

    for (const order of cardOrders) {
      await db.execute("UPDATE cards SET sort = ? WHERE id = ?", [
        order.sort,
        order.cardId,
      ]);
    }

    const [rows]: any = await db.execute(
      "SELECT * FROM cards WHERE area = ? ORDER BY sort ASC",
      [id],
    );

    const serverSocket = getServerSocket();
    if (serverSocket) {
      for (const order of cardOrders) {
        serverSocket.to(`board-${board.id}`).emit("orderdCard", {
          cardId: order.cardId,
          areaId: id,
          newIndex: order.sort,
          boardId: board.id,
        });
      }
    }

    const cards = await attachAssignees(db, rows);
    return jsonResult({ cards: cards.map(serializeCard) });
  },
});
