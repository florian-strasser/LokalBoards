import { defineEventHandler, readBody } from "h3";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { getServerSocket } from "../../utils/socket";
import { putCard, renumberColumn } from "../../utils/cardPositions";

export default defineEventHandler(async (event) => {
  const method = event.req.method;

  // Resolve the authenticated user (API key or session).
  const auth = await resolveUserId(event);
  if (!auth.ok) {
    event.res.statusCode = auth.status;
    return { error: auth.error };
  }
  const userId = auth.userId;

  try {
    const db = setupDatabase();

    if (method === "POST") {
      const { cardId, fromAreaId, toAreaId, newIndex } = await readBody(event);

      // HIGH FIX: Validate all required fields with generic message
      if (!cardId || !fromAreaId || !toAreaId || newIndex === undefined) {
        event.res.statusCode = 400;
        return {
          error: "Required fields are missing",
        };
      }

      // HIGH FIX: Validate all IDs are positive integers
      if (
        isNaN(Number(cardId)) ||
        Number(cardId) <= 0 ||
        isNaN(Number(fromAreaId)) ||
        Number(fromAreaId) <= 0 ||
        isNaN(Number(toAreaId)) ||
        Number(toAreaId) <= 0
      ) {
        event.res.statusCode = 400;
        return { error: "Invalid ID values" };
      }

      // CRITICAL FIX: Check access to BOTH source and destination boards
      const [fromBoardRows] = (await db.execute(
        "SELECT b.* FROM boards b JOIN areas a ON b.id = a.board WHERE a.id = ?",
        [fromAreaId],
      )) as any[];
      const fromBoard = (fromBoardRows as any[])[0];

      if (!fromBoard) {
        // HIGH FIX: Generic error to prevent board enumeration
        event.res.statusCode = 404;
        return { error: "Resource not found" };
      }

      const [toBoardRows] = (await db.execute(
        "SELECT b.* FROM boards b JOIN areas a ON b.id = a.board WHERE a.id = ?",
        [toAreaId],
      )) as any[];
      const toBoard = (toBoardRows as any[])[0];

      if (!toBoard) {
        // HIGH FIX: Generic error to prevent board enumeration
        event.res.statusCode = 404;
        return { error: "Resource not found" };
      }

      // Require write access to the source board, and (if different) the
      // destination board too.
      const fromDecision = await authorizeBoard(db, fromBoard, userId, "edit");
      if (!fromDecision.ok) {
        event.res.statusCode = fromDecision.status;
        return { error: fromDecision.error };
      }

      if (toBoard.id !== fromBoard.id) {
        const toDecision = await authorizeBoard(db, toBoard, userId, "edit");
        if (!toDecision.ok) {
          event.res.statusCode = toDecision.status;
          return { error: toDecision.error };
        }
      }

      // The card has to be where the request says it is. Both areas being
      // ones this person may edit said nothing about the card itself, so any
      // card id at all — from a board they cannot even see — could be pulled
      // into one of their own.
      const [inArea] = (await db.execute(
        "SELECT id FROM cards WHERE id = ? AND area = ?",
        [cardId, fromAreaId],
      )) as any[];
      if (!(inArea as any[]).length) {
        event.res.statusCode = 404;
        return { error: "Resource not found" };
      }

      {
        try {
          // `newIndex` counts the cards the board shows in the destination, so
          // archived ones and gaps are stepped over rather than counted (see
          // `cardPositions`).
          await putCard(db, Number(toAreaId), Number(cardId), Number(newIndex));
          if (Number(fromAreaId) !== Number(toAreaId))
            await renumberColumn(db, Number(fromAreaId));

          // Fetch card name and area names for notification
          const [cardRows] = (await db.execute(
            "SELECT name FROM cards WHERE id = ?",
            [cardId],
          )) as any[];
          const cardName = (cardRows as any[])[0]?.name;

          // Fetch source and destination area names
          const [fromAreaRows] = (await db.execute(
            "SELECT name FROM areas WHERE id = ?",
            [fromAreaId],
          )) as any[];
          const fromAreaName = (fromAreaRows as any[])[0]?.name;

          const [toAreaRows] = (await db.execute(
            "SELECT name FROM areas WHERE id = ?",
            [toAreaId],
          )) as any[];
          const toAreaName = (toAreaRows as any[])[0]?.name;

          await recordCardActivity(cardId, "moved", userId, {
            from: fromAreaName,
            to: toAreaName,
          });

          // Fetch all users who have access to the board (owner and invited users)
          const [boardRows] = (await db.execute(
            "SELECT user, id AS boardId FROM boards WHERE id = (SELECT board FROM areas WHERE id = ?)",
            [toAreaId],
          )) as any[];
          const boardOwner = (boardRows as any[])[0]?.user;
          const boardId = (boardRows as any[])[0]?.boardId;

          const [invitedUsers] = (await db.execute(
            "SELECT user FROM invitations WHERE board = (SELECT board FROM areas WHERE id = ?)",
            [toAreaId],
          )) as any[];

          // Create notifications for the board owner and invited users
          const usersToNotify = [
            boardOwner,
            ...(invitedUsers as any[]).map((inv: any) => inv.user),
          ].filter(Boolean);

          for (const notifyUserId of usersToNotify) {
            if (notifyUserId !== userId) {
              // Don't notify the user who moved the card
              await db.execute(
                "INSERT INTO notifications (userId, type, boardId, cardId, message, actorId) VALUES (?, ?, ?, ?, ?, ?)",
                [
                  notifyUserId,
                  "card_moved",
                  boardId,
                  cardId,
                  `Card "${cardName}" moved from "${fromAreaName}" to "${toAreaName}"`,
                                userId,
              ],
              );
            }
          }

          // Emit socket event for card move (API calls only)
          if (auth.viaApiKey) {
            const serverSocket = getServerSocket();
            if (serverSocket) {
              serverSocket.to(`board-${boardId}`).emit("movedCard", {
                cardId,
                fromAreaId,
                toAreaId,
                newIndex,
                boardId,
              });
            }
          }

          return { success: true };
        } catch (error) {
          throw error;
        }
      }
    } else {
      event.res.statusCode = 405;
      return { error: "Method not allowed" };
    }
  } catch (error) {
    logger.error("Database error:", error);
    event.res.statusCode = 500;
    return { error: "Internal server error" };
  }
});
