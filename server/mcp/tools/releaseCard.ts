import { defineMcpTool } from "@nuxtjs/mcp-toolkit/server";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { getServerSocket } from "../../utils/socket";
import { recordCardActivity } from "../../utils/cardActivity";
import { attachAssignees, releaseCardFor } from "../../utils/cardAssignees";
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
  name: "releaseCard",
  title: "Release a claimed card",
  description:
    "Give up a card you claimed (takes you off it) so someone else can pick it up. Only takes you off — anyone else on the card stays, and releasing a card you are not on does nothing and returns released=false. Call this if you abandon a task without finishing it.",
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

    const wasMine = await releaseCardFor(db, id, userId);
    const [rows]: any = await db.execute("SELECT * FROM cards WHERE id = ?", [
      id,
    ]);
    const [updated] = await attachAssignees(db, rows);

    if (wasMine) {
      await recordCardActivity(id, "assigned", userId, {
        assigneeId: userId,
        removed: true,
      });
      const serverSocket = getServerSocket();
      if (serverSocket) {
        serverSocket.to(`board-${board.id}`).emit("updateCard", {
          boardId: board.id,
          attachments: [],
          card: { ...updated, status: !!updated.status },
        });
      }
    }

    return jsonResult({ released: wasMine, card: serializeCard(updated) });
  },
});
