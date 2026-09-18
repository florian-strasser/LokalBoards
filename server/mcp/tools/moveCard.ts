import { z } from "zod";
import { defineMcpTool } from "@nuxtjs/mcp-toolkit/server";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { getServerSocket } from "../../utils/socket";
import { putCard, renumberColumn } from "../../utils/cardPositions";
import {
  requireUserId,
  requireWriteAccess,
  requireCard,
  requireArea,
  McpError,
} from "../../utils/mcpHelpers";

const db = setupDatabase();

export default defineMcpTool({
  name: "moveCard",
  title: "Move a card",
  description:
    "Move a card to a position in an area (its current area or a different one). `position` is 0-based (0 = top). Moving across areas needs edit access to both. To only reorder within the same area you can also use orderCard.",
  annotations: {
    readOnlyHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    cardId: z
      .number()
      .int()
      .positive()
      .describe("The card to move (from listCards)."),
    toAreaId: z.number().int().positive().describe("The destination area id."),
    position: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "0-based target position in the destination area (default: end).",
      ),
    newIndex: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Deprecated alias for position."),
    fromAreaId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Deprecated/ignored — the source area is derived from the card.",
      ),
  },
  inputExamples: [{ cardId: 1, toAreaId: 2, position: 0 }],
  handler: async ({ cardId, toAreaId, position, newIndex, fromAreaId }) => {
    const userId = requireUserId();
    requireWriteAccess();
    if (!cardId || !toAreaId) {
      throw new McpError("VALIDATION", "cardId and toAreaId are required.");
    }
    const { card, board } = await requireCard(cardId, userId, "edit");
    const sourceAreaId = card.area;
    const { area: toArea, board: toBoard } = await requireArea(
      toAreaId,
      userId,
      "edit",
    );

    // Both ends are authorized individually, but a move ACROSS boards would
    // leave the two halves disagreeing: the socket event goes to one board's
    // room while the notification goes to the other, so neither board's viewers
    // see a consistent picture. Cards move between areas of one board.
    if (toBoard.id !== board.id) {
      throw new McpError(
        "VALIDATION",
        "toAreaId belongs to a different board. A card can only move between areas of its own board.",
      );
    }

    // Counted among the cards `listCards` returns — archived ones are stepped
    // over — and the end of the column when no position is given (see
    // `cardPositions`).
    const index = await putCard(db, toAreaId, cardId, position ?? newIndex ?? null);
    if (sourceAreaId !== toAreaId) await renumberColumn(db, sourceAreaId);

    // Notify collaborators (destination board) except the mover.
    if (sourceAreaId !== toAreaId) {
      const [[srcArea]]: any = await db.query(
        "SELECT name FROM areas WHERE id = ?",
        [sourceAreaId],
      );
      const [invited]: any = await db.execute(
        "SELECT user FROM invitations WHERE board = ?",
        [toBoard.id],
      );
      for (const notifyUserId of [
        toBoard.user,
        ...invited.map((i: any) => i.user),
      ].filter(Boolean)) {
        if (notifyUserId !== userId) {
          await db.execute(
            "INSERT INTO notifications (userId, type, boardId, cardId, message, actorId) VALUES (?, ?, ?, ?, ?, ?)",
            [
              notifyUserId,
              "card_moved",
              toBoard.id,
              cardId,
              `Card "${card.name}" moved from "${srcArea?.name}" to "${toArea.name}"`,
                            userId,
              ],
          );
        }
      }
    }

    const serverSocket = getServerSocket();
    if (serverSocket) {
      serverSocket.to(`board-${board.id}`).emit("movedCard", {
        cardId,
        fromAreaId: sourceAreaId,
        toAreaId,
        newIndex: index,
        boardId: board.id,
      });
    }

    return jsonResult({ moved: true, cardId, toAreaId, position: index });
  },
});
