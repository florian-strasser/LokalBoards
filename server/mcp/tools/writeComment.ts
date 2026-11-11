import { z } from "zod";
import { defineMcpTool } from "@nuxtjs/mcp-toolkit/server";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { addComment } from "../../utils/comments";
import {
  requireUserId,
  requireWriteAccess,
  requireCard,
  requireId,
  cardIdInput,
  serializeComment,
} from "../../utils/mcpHelpers";

const db = setupDatabase();

export default defineMcpTool({
  name: "writeComment",
  title: "Comment on a card",
  description:
    "Add a comment to a card, authored by the current user. `content` is Markdown. Collaborators are notified. Needs edit access to the board.",
  annotations: { readOnlyHint: false, openWorldHint: false },
  inputSchema: {
    ...cardIdInput,
    content: z.string().min(1).describe("The comment body, in Markdown."),
  },
  inputExamples: [
    { cardId: 1, content: "Looks good — can we try a **darker** blue?" },
  ],
  handler: async ({ cardId, cardID, content }) => {
    const userId = requireUserId();
    requireWriteAccess();
    const id = requireId(cardId, cardID, "cardId");
    const comment = await addComment(db, await requireCard(id, userId, "edit"), userId, content, true);
    return jsonResult({ comment: serializeComment(comment) });
  },
});
