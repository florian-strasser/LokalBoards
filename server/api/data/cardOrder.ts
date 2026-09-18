import { defineEventHandler, readBody } from "h3";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { getServerSocket } from "../../utils/socket";
import { putCard } from "../../utils/cardPositions";

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
      const { cardId, areaId, newIndex } = await readBody(event);

      // HIGH FIX: Validate all required fields with generic message
      if (!cardId || !areaId || newIndex === undefined) {
        event.res.statusCode = 400;
        return { error: "Required fields are missing" };
      }

      // HIGH FIX: Validate all IDs are positive integers
      if (
        isNaN(Number(cardId)) ||
        Number(cardId) <= 0 ||
        isNaN(Number(areaId)) ||
        Number(areaId) <= 0
      ) {
        event.res.statusCode = 400;
        return { error: "Invalid ID values" };
      }

      const [boardRows] = await db.execute(
        "SELECT b.* FROM boards b JOIN areas a ON b.id = a.board WHERE a.id = ?",
        [areaId],
      );
      const board = boardRows[0];

      if (!board) {
        // HIGH FIX: Generic error to prevent board enumeration
        event.res.statusCode = 404;
        return { error: "Resource not found" };
      }

      const writeDecision = await authorizeBoard(db, board, userId, "edit");
      if (!writeDecision.ok) {
        event.res.statusCode = writeDecision.status;
        return { error: writeDecision.error };
      }

      {
        try {
          // `newIndex` is where the card ended up in a list it is already part
          // of — SortableJS reports the position *after* the move. So the order
          // being described is: take this card out of the area's list, then put
          // it back at that index.
          //
          // Making room first with `sort = sort + 1 WHERE sort >= newIndex` and
          // then writing the card's new sort was wrong in one direction. Moving
          // a card down, its own old slot is above the shifted range and stays
          // where it is, so everything between the old and new position moves
          // one place too few and the card lands one short of where it was
          // dropped — visibly correct until the page was reloaded. Moving up
          // happened to come out right, which is why it went unnoticed.
          //
          // The index counts the cards the board shows, so archived ones are
          // stepped over rather than counted (see `cardPositions`).
          const [inArea]: any = await db.execute(
            "SELECT id FROM cards WHERE id = ? AND area = ?",
            [cardId, areaId],
          );
          if (!inArea.length) {
            event.res.statusCode = 404;
            return { error: "Resource not found" };
          }

          await putCard(db, Number(areaId), Number(cardId), Number(newIndex));

          // Emit socket event for card reordering (API calls only)
          if (auth.viaApiKey) {
            const serverSocket = getServerSocket();
            if (serverSocket) {
              serverSocket.to(`board-${board.id}`).emit("orderdCard", {
                cardId,
                areaId,
                newIndex,
                boardId: board.id,
              });
            }
          }

          return { success: true };
        } catch (error) {
          // HIGH FIX: Don't leak internal error details
          logger.error("Database error:", error);
          event.res.statusCode = 500;
          return { error: "Internal server error" };
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
