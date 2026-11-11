import { defineMcpTool } from "@nuxtjs/mcp-toolkit/server";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { cardsMatching } from "../../utils/cardLists";
import {
  requireUserId,
  requireCard,
  requireId,
  cardIdInput,
  serializeCard,
} from "../../utils/mcpHelpers";

const db = setupDatabase();

export default defineMcpTool({
  name: "getCard",
  title: "Get a card",
  description:
    "Get a single card by id: id, areaId, name, Markdown content, done (boolean), dueDate (ISO 8601 or null), repeat, assigneeIds (everyone on it) and assigneeId (the first of them), position, and comment/attachment counts. Use listComments for the actual comments. A card that is archived, or in an archived area or on an archived board, is NOT_FOUND.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: { ...cardIdInput },
  inputExamples: [{ cardId: 1 }],
  handler: async ({ cardId, cardID }) => {
    const userId = requireUserId();
    const id = requireId(cardId, cardID, "cardId");
    // A card in the archive — on its own, or with its area or its board — is
    // NOT_FOUND, as a card that was never there is (see requireCard).
    await requireCard(id, userId, "read");
    const [card] = await cardsMatching(db, { cardId: id });
    return jsonResult({ card: serializeCard(card) });
  },
});
