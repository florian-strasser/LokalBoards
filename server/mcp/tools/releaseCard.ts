import { defineMcpTool } from "@nuxtjs/mcp-toolkit/server";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { emitToBoard } from "../../utils/socket";
import { cardForBoard } from "../../utils/cards";
import { recordCardActivity } from "../../utils/cardActivity";
import { releaseCardFor } from "../../utils/cardAssignees";
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
    const updated = await cardForBoard(db, id);

    if (wasMine) {
      await recordCardActivity(id, "assigned", userId, {
        assigneeId: userId,
        removed: true,
      });
      emitToBoard(board.id, "updateCard", { boardId: board.id, attachments: [], card: updated });
    }

    return jsonResult({ released: wasMine, card: serializeCard(updated) });
  },
});
