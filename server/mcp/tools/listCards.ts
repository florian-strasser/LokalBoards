import { defineMcpTool } from "@nuxtjs/mcp-toolkit/server";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { cardsMatching } from "../../utils/cardLists";
import {
  requireUserId,
  requireArea,
  requireId,
  areaIdInput,
  serializeCard,
} from "../../utils/mcpHelpers";

const db = setupDatabase();

export default defineMcpTool({
  name: "listCards",
  title: "List cards",
  description:
    "List the cards in an area, in order. Each card has id, areaId, name, Markdown content, done (boolean), dueDate (ISO 8601 or null), repeat, assigneeIds (everyone on it), assigneeId (the first of them), position and comment/attachment counts. Archived cards are not listed, and an area in the archive, or on a board in the archive, is NOT_FOUND. Requires read access to the board.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: { ...areaIdInput },
  inputExamples: [{ areaId: 1 }],
  handler: async ({ areaId, areaID }) => {
    const userId = requireUserId();
    const id = requireId(areaId, areaID, "areaId");
    await requireArea(id, userId, "read");
    // The cards the area shows on its board, the same ones GET /api/data/cards
    // lists.
    const cards = await cardsMatching(db, { areaId: id });
    return jsonResult({ cards: cards.map(serializeCard) });
  },
});
