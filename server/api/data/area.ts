import { defineEventHandler, readBody, getQuery } from "h3";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { removeAreaCompletely } from "../../utils/boardCleanup";
import { getServerSocket } from "../../utils/socket";

export default defineEventHandler(async (event) => {
  // Check the HTTP method
  const method = event.req.method;

  // Resolve the authenticated user (API key or session).
  const auth = await resolveUserId(event);
  if (!auth.ok) {
    event.res.statusCode = auth.status;
    return { error: auth.error };
  }
  const userId = auth.userId;

  try {
    // Initialize database
    const db = setupDatabase();

    if (method === "POST") {
      // Handle POST request to create or update an area
      const { id, boardId, name } = await readBody(event);

      if (!boardId || !name) {
        event.res.statusCode = 400;
        return { error: "Board ID and name are required" };
      }

      const [brows] = await db.execute("SELECT * FROM boards WHERE id = ?", [
        boardId,
      ]);
      const board = brows[0];

      if (!board) {
        event.res.statusCode = 404;
        return { error: "Board not found" };
      }

      const writeDecision = await authorizeBoard(db, board, userId, "edit");
      if (!writeDecision.ok) {
        event.res.statusCode = writeDecision.status;
        return { error: writeDecision.error };
      }
      {
        let area;
        if (id) {
          // Update existing area
          const [result] = await db.execute(
            "UPDATE areas SET name = ? WHERE id = ? AND board = ?",
            [name, id, boardId],
          );

          if (result.affectedRows === 0) {
            event.res.statusCode = 404;
            return {
              error: "Area not found or you do not have permission to edit it",
            };
          }

          const [rows] = await db.execute(
            "SELECT * FROM areas WHERE id = ? AND board = ?",
            [id, boardId],
          );
          area = rows[0];
          // Emit socket event for area update (API calls only)
          if (auth.viaApiKey) {
            const serverSocket = getServerSocket();
            if (serverSocket) {
              serverSocket.to(`board-${boardId}`).emit("updateArea", {
                area,
                boardId,
              });
            }
          }
        } else {
          const [arows] = await db.execute(
            "SELECT * FROM areas WHERE board = ?",
            [boardId],
          );
          const areaCount = arows ? arows.length + 1 : 0;
          // Create new area
          const [result] = await db.execute(
            "INSERT INTO areas (board, name, sort) VALUES (?, ?, ?)",
            [boardId, name, areaCount],
          );

          const [rows] = await db.execute(
            "SELECT * FROM areas WHERE id = ? AND board = ?",
            [result.insertId, boardId],
          );
          area = rows[0];
          // Emit socket event for area creation (API calls only)
          if (auth.viaApiKey) {
            const serverSocket = getServerSocket();
            if (serverSocket) {
              serverSocket.to(`board-${boardId}`).emit("addArea", {
                area,
                boardId,
              });
            }
          }
        }

        return { area };
      }
    } else if (method === "DELETE") {
      // Handle DELETE request to delete an area
      const query = getQuery(event);
      const id = query.id;
      const boardId = query.boardId;
      // Archiving unless the archive itself asks for the unrecoverable one.
      const permanent = String(query.permanent ?? "") === "true";
      if (!id || !boardId) {
        event.res.statusCode = 400;
        return {
          error: "Area ID and board ID are required for DELETE requests",
        };
      }

      const [brows] = await db.execute("SELECT * FROM boards WHERE id = ?", [
        boardId,
      ]);
      const board = brows[0];

      if (!board) {
        event.res.statusCode = 404;
        return { error: "Board not found" };
      }

      // Deleting an area requires write access (owner or an `edit` invitation).
      const writeDecision = await authorizeBoard(db, board, userId, "edit");
      if (!writeDecision.ok) {
        event.res.statusCode = writeDecision.status;
        return { error: writeDecision.error };
      }
      {
        const [rows] = await db.execute("SELECT * FROM areas WHERE id = ?", [
          id,
        ]);
        const area = rows[0];

        if (!area) {
          event.res.statusCode = 404;
          return { error: "Area not found" };
        }

        // Check if the area belongs to the board
        if (area.board != boardId) {
          event.res.statusCode = 403;
          return { error: "You don't have permission to delete this area" };
        }
        // An archived area takes its cards with it without touching them: the
        // cards keep their own `archivedAt` as null, and the board simply stops
        // asking for the cards of areas that are not there. Restoring the area
        // brings back exactly what was in it, in the order it was in.
        if (!permanent) {
          await db.execute(
            "UPDATE areas SET archivedAt = NOW() WHERE id = ? AND archivedAt IS NULL",
            [id],
          );
          if (auth.viaApiKey) {
            const serverSocket = getServerSocket();
            serverSocket
              ?.to(`board-${boardId}`)
              .emit("deleteArea", { area: id, boardId });
          }
          return { message: "Area archived successfully" };
        }

        // The area with every card in it. The same call the nightly archive
        // sweep makes, so the two can never mean different things.
        await removeAreaCompletely(db, Number(id));

        // Emit socket event for area deletion (API calls only)
        if (auth.viaApiKey) {
          const serverSocket = getServerSocket();
          if (serverSocket) {
            serverSocket.to(`board-${boardId}`).emit("deleteArea", {
              area: id,
              boardId,
            });
          }
        }

        return { message: "Area deleted successfully" };
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
