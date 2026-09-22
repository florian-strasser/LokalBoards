import { defineMcpTool } from "@nuxtjs/mcp-toolkit/server";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { getServerSocket } from "../../utils/socket";
import { removeCardData } from "../../utils/cardCleanup";
import { dispatchWebhooks } from "../../utils/webhooks";
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
  title: "Delete a card",
  description:
    "Permanently delete a card and its comments, attachments references and notifications. This cannot be undone. Needs edit access to the board.",
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: { ...cardIdInput },
  inputExamples: [{ cardId: 1 }],
  handler: async ({ cardId, cardID }) => {
    const userId = requireUserId();
    requireWriteAccess();
    const id = requireId(cardId, cardID, "cardId");
    const { card, board } = await requireCard(id, userId, "edit");

    // Everything that hangs off the card goes with it — its comments, files,
    // labels, reminders, people and history — the same way the app removes a
    // card for good. This used to take the comments, attachments and
    // notifications only, and leave the rest behind.
    await removeCardData(db, [id]);
    await db.execute("DELETE FROM cards WHERE id = ?", [id]);

    const serverSocket = getServerSocket();
    if (serverSocket) {
      serverSocket.to(`board-${board.id}`).emit("deletedCard", {
        boardId: board.id,
        card,
      });
    }

    dispatchWebhooks({
      boardId: board.id,
      event: "card.deleted",
      actorUserId: userId,
      card: { id, name: card.name },
    });

    return jsonResult({ deleted: true, cardId: id });
  },
});
