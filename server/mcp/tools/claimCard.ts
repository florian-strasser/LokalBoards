import { defineMcpTool } from "@nuxtjs/mcp-toolkit/server";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { getServerSocket } from "../../utils/socket";
import { dispatchWebhooks } from "../../utils/webhooks";
import { recordCardActivity } from "../../utils/cardActivity";
import { attachAssignees, claimCardFor } from "../../utils/cardAssignees";
import {
  requireUserId,
  requireWriteAccess,
  requireCard,
  requireId,
  cardIdInput,
  serializeCard,
} from "../../utils/mcpHelpers";

const db = setupDatabase();

export default defineMcpTool({
  name: "claimCard",
  title: "Claim a card to work on",
  description:
    "Atomically take ownership of a card by putting yourself on it, so two agents (or an agent and a human) never work the same card. Succeeds only if nobody is on the card yet — or you already are. Returns claimed=true if you now hold it, or claimed=false with heldBy telling you who does (the first person on it); in that case skip the card and take another. Call releaseCard if you abandon it unfinished.",
  annotations: {
    readOnlyHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: { ...cardIdInput },
  inputExamples: [{ cardId: 1 }],
  handler: async ({ cardId, cardID }) => {
    const userId = requireUserId();
    requireWriteAccess();
    const id = requireId(cardId, cardID, "cardId");
    const { board } = await requireCard(id, userId, "edit");

    // The atomic bit lives in `claimCardFor`: the card's row is locked while
    // it is asked whether anybody is on it, so two claims cannot both find it
    // free. Only a card that was free changes hands; re-claiming your own is a
    // no-op and must not re-broadcast or re-fire webhooks.
    const { claimed, wasFree } = await claimCardFor(db, id, userId);
    const [rows]: any = await db.execute("SELECT * FROM cards WHERE id = ?", [
      id,
    ]);
    const [card] = await attachAssignees(db, rows);

    if (claimed && wasFree) {
      const serverSocket = getServerSocket();
      if (serverSocket) {
        serverSocket.to(`board-${board.id}`).emit("updateCard", {
          boardId: board.id,
          attachments: [],
          card: { ...card, status: !!card.status },
        });
      }
      await recordCardActivity(id, "assigned", userId, { assigneeId: userId });
      dispatchWebhooks({
        boardId: board.id,
        event: "card.claimed",
        actorUserId: userId,
        card: serializeCard(card),
      });
    }

    const holder = card.assignees[0] ?? null;
    return jsonResult({
      claimed,
      card: serializeCard(card),
      heldBy: holder
        ? {
            userId: holder.id,
            name: holder.name ?? null,
            type: holder.type ?? "human",
          }
        : null,
    });
  },
});
