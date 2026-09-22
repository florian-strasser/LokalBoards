import { defineMcpTool } from "@nuxtjs/mcp-toolkit/server";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { attachAssignees } from "../../utils/cardAssignees";
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
    "Get a single card by id: id, areaId, name, Markdown content, done (boolean), dueDate (ISO 8601 or null), repeat, assigneeIds (everyone on it) and assigneeId (the first of them), position, and comment/attachment counts. Use listComments for the actual comments.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: { ...cardIdInput },
  inputExamples: [{ cardId: 1 }],
  handler: async ({ cardId, cardID }) => {
    const userId = requireUserId();
    const id = requireId(cardId, cardID, "cardId");
    const { card } = await requireCard(id, userId, "read");
    const [[counts]]: any = await db.query(
      "SELECT (SELECT COUNT(*) FROM comments WHERE card = ?) AS commentCount, (SELECT COUNT(*) FROM attachments WHERE card = ?) AS attachmentCount",
      [id, id],
    );
    const [withPeople] = await attachAssignees(db, [{ ...card, ...counts }]);
    return jsonResult({ card: serializeCard(withPeople) });
  },
});
