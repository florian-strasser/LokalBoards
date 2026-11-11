import { z } from "zod";
import { defineMcpTool } from "@nuxtjs/mcp-toolkit/server";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { moveCard } from "../../utils/cards";
import {
  requireUserId,
  requireWriteAccess,
  requireCard,
  requireArea,
  McpError,
} from "../../utils/mcpHelpers";

const db = setupDatabase();

export default defineMcpTool({
  name: "moveCard",
  title: "Move a card",
  description:
    "Move a card to a position in an area: its current one, another on the same board, or one on another board. `position` is 0-based (0 = top). Moving needs edit access to the card's board and to the destination's. To only reorder within the same area you can also use orderCard.",
  annotations: {
    readOnlyHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    cardId: z
      .number()
      .int()
      .positive()
      .describe("The card to move (from listCards)."),
    toAreaId: z.number().int().positive().describe("The destination area id."),
    position: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "0-based target position in the destination area (default: end).",
      ),
    newIndex: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Deprecated alias for position."),
    fromAreaId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Deprecated/ignored — the source area is derived from the card.",
      ),
  },
  inputExamples: [{ cardId: 1, toAreaId: 2, position: 0 }],
  handler: async ({ cardId, toAreaId, position, newIndex }) => {
    const userId = requireUserId();
    requireWriteAccess();
    if (!cardId || !toAreaId) {
      throw new McpError("VALIDATION", "cardId and toAreaId are required.");
    }
    const from = await requireCard(cardId, userId, "edit");
    const to = await requireArea(toAreaId, userId, "edit");
    // Counted among the cards `listCards` returns — archived ones are stepped
    // over — and the end of the column when no position is given (see
    // `cardPositions`).
    const { index } = await moveCard(
      db,
      from,
      to,
      userId,
      position ?? newIndex ?? null,
      true,
    );
    return jsonResult({ moved: true, cardId, toAreaId, position: index });
  },
});
