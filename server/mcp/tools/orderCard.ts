import { z } from "zod";
import { defineMcpTool } from "@nuxtjs/mcp-toolkit/server";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { attachAssignees } from "../../utils/cardAssignees";
import { orderCard } from "../../utils/cards";
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

    const [belong]: any = await db.query(
      "SELECT * FROM cards WHERE area = ? AND archivedAt IS NULL AND id IN (?)",
      [id, cardOrders.map((order: any) => order.cardId)],
    );
    if (belong.length !== new Set(cardOrders.map((order: any) => order.cardId)).size) {
      throw new McpError("VALIDATION", "Every cardId must be a card in the given area, not in the archive.");
    }
    // Lowest position first: each card put in place then stays there while the
    // ones after it are placed. Positions are counted the way the board counts
    // them, stepping over archived cards (see `cardPositions`).
    const byId = new Map(belong.map((card: any) => [card.id, card]));
    for (const order of [...cardOrders].sort((a: any, b: any) => a.sort - b.sort)) {
      await orderCard(db, { card: byId.get(order.cardId), board }, order.sort, true);
    }

    const [rows]: any = await db.execute(
      "SELECT * FROM cards WHERE area = ? AND archivedAt IS NULL ORDER BY sort ASC",
      [id],
    );
    const cards = await attachAssignees(db, rows);
    return jsonResult({ cards: cards.map(serializeCard) });
  },
});
