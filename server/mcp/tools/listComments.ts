import { defineMcpTool } from "@nuxtjs/mcp-toolkit/server";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { commentsOn } from "../../utils/comments";
import {
  requireUserId,
  requireCard,
  requireId,
  cardIdInput,
  serializeComment,
} from "../../utils/mcpHelpers";

const db = setupDatabase();

export default defineMcpTool({
  name: "listComments",
  title: "List comments",
  description:
    "List a card's comments, oldest first. Each has id, authorId (the local user id, or null for imported comments), authorName, Markdown content and date (ISO 8601). Requires read access to the board.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: { ...cardIdInput },
  inputExamples: [{ cardId: 1 }],
  handler: async ({ cardId, cardID }) => {
    const userId = requireUserId();
    const id = requireId(cardId, cardID, "cardId");
    await requireCard(id, userId, "read");
    const comments = (await commentsOn(db, id)).reverse();
    return jsonResult({ comments: comments.map(serializeComment) });
  },
});
