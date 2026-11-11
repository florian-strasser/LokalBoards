import { defineMcpTool } from "@nuxtjs/mcp-toolkit/server";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { archiveCard } from "../../utils/cards";
import {
  requireUserId,
  requireWriteAccess,
  requireCard,
  requireId,
  cardIdInput,
} from "../../utils/mcpHelpers";

const db = setupDatabase();

export default defineMcpTool({
  name: "deleteCard",
  title: "Archive a card",
  description:
    "Archive a card, as deleting one in the app does: it leaves the board with its comments, files and history, and can be restored from the board's archive, where it is deleted for good after the retention period. Needs edit access to the board.",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: { ...cardIdInput },
  inputExamples: [{ cardId: 1 }],
  handler: async ({ cardId, cardID }) => {
    const userId = requireUserId();
    requireWriteAccess();
    const id = requireId(cardId, cardID, "cardId");
    // Into the archive, as in the app: an agent's mistake can be undone there.
    await archiveCard(db, await requireCard(id, userId, "edit"), userId, true);
    return jsonResult({ archived: true, cardId: id });
  },
});
