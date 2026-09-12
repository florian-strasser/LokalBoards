import { defineEventHandler, readBody, getQuery } from "h3";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { getServerSocket } from "../../utils/socket";
import { removeBoardCompletely } from "../../utils/boardCleanup";
// The same parser the tile and the picker use, so a colour cannot be stored in
// a form the UI would then refuse to render.
import { normalizeBoardColor } from "../../../app/utils/boardColor";

export default defineEventHandler(async (event) => {
  // Check the HTTP method
  const method = event.req.method;

  try {
    // Initialize database
    const db = setupDatabase();

    if (method === "GET") {
      // Handle GET request to fetch board data
      const query = getQuery(event);
      const id = query.id;

      // Resolve auth + access in one place (validates id, loads board, decides
      // read/edit/none).
      const auth = await requireBoardAccess(event, id, "read");
      if (!auth.ok) {
        event.res.statusCode = auth.status;
        return { error: auth.error };
      }

      return { board: auth.board, writeAccess: auth.access === "edit" };
    } else if (method === "POST") {
      // Get the board data from the request body
      const {
        id,
        userId: bodyUserId,
        name,
        style,
        image,
        color,
        status,
      } = await readBody(event);

      // Anything that isn't a hex colour — including the empty string the UI
      // sends for "no colour" — becomes NULL, i.e. the default tile. The value
      // ends up in a CSS custom property, so this is the boundary that keeps
      // the stylesheet safe rather than a formatting nicety.
      const boardColor = normalizeBoardColor(color);

      // Resolve the authenticated user.
      const auth = await resolveUserId(event);
      if (!auth.ok) {
        event.res.statusCode = auth.status;
        return { error: auth.error };
      }
      const userId = auth.userId;

      // HIGH FIX: Validate required fields with generic message
      if (!bodyUserId || !name || !style || !status) {
        event.res.statusCode = 400;
        return {
          error: "Required fields are missing",
        };
      }

      // CRITICAL FIX: Ensure body userId matches authenticated user
      if (bodyUserId !== userId) {
        event.res.statusCode = 403;
        return { error: "Unauthorized access" };
      }

      // HIGH FIX: Validate id if present
      if (id && (isNaN(Number(id)) || Number(id) <= 0)) {
        event.res.statusCode = 400;
        return { error: "Invalid board ID" };
      }

      let board;
      if (id) {
        const [brows] = await db.execute("SELECT * FROM boards WHERE id = ?", [
          id,
        ]);
        board = brows[0];

        if (!board) {
          event.res.statusCode = 404;
          return { error: "Resource not found" };
        }

        // Editing the board record requires write access (owner or an `edit`
        // invitation). Public status does not grant write.
        const decision = await authorizeBoard(db, board, userId, "edit");
        if (!decision.ok) {
          event.res.statusCode = decision.status;
          return { error: decision.error };
        }
        {
          // Update existing board
          const [result] = await db.execute(
            "UPDATE boards SET name = ?, style = ?, image = ?, color = ?, status = ? WHERE id = ? AND user = ?",
            [name, style, image, boardColor, status, id, userId],
          );

          if (result.affectedRows === 0) {
            event.res.statusCode = 404;
            return {
              error: "Resource not found or access denied",
            };
          }

          const [rows] = await db.execute("SELECT * FROM boards WHERE id = ?", [
            id,
          ]);
          board = rows[0];

          // Emit socket event for board update (API calls only)
          if (auth.viaApiKey) {
            const serverSocket = getServerSocket();
            if (serverSocket) {
              serverSocket.to(`board-${id}`).emit("updateBoard", {
                boardID: id,
                boardName: board.name,
                boardStatus: board.status,
                boardStyle: board.style,
                boardImage: board.image,
                boardColor: board.color,
              });
            }
          }

          // The tile on every dashboard showing this board is its name and its
          // colour or image, so a change here is a change there — whichever
          // client made it, including one holding an API key.
          await notifyDashboards(db, id);
        }
      } else {
        // Create new board
        const [result] = await db.execute(
          "INSERT INTO boards (user, name, style, image, color, status) VALUES (?, ?, ?, ?, ?, ?)",
          [userId, name, style, image, boardColor, status],
        );

        const [rows] = await db.execute("SELECT * FROM boards WHERE id = ?", [
          result.insertId,
        ]);
        board = rows[0];
      }

      return {
        board,
      };
    } else if (method === "DELETE") {
      // Handle DELETE request: archives the board, or removes it and
      // everything in it for good when the archive asks for that.
      const query = getQuery(event);
      const id = query.id;
      const permanent = String(query.permanent ?? "") === "true";

      // Deleting a board is owner-only, so resolve the user and check ownership
      // directly rather than using the general access helper.
      const auth = await resolveUserId(event);
      if (!auth.ok) {
        event.res.statusCode = auth.status;
        return { error: auth.error };
      }
      const userId = auth.userId;

      // HIGH FIX: Validate boardId is a positive integer
      if (!id || isNaN(Number(id)) || Number(id) <= 0) {
        event.res.statusCode = 400;
        return {
          error: "Invalid board ID",
        };
      }

      const [rows] = await db.execute("SELECT * FROM boards WHERE id = ?", [
        id,
      ]);
      const board = rows[0];

      if (!board) {
        // HIGH FIX: Generic error to prevent board enumeration
        event.res.statusCode = 404;
        return { error: "Resource not found" };
      }

      // Check if the user has permission to delete the board
      if (board.user !== userId) {
        event.res.statusCode = 403;
        return { error: "Unauthorized access" };
      }

      // Who to tell, read before anything is deleted: once the board and its
      // invitations are gone there is no way to work out whose dashboards were
      // showing it.
      const memberIds = await getBoardMemberIds(db, id);

      // Archiving leaves all of it in place — the areas, the cards, the
      // invitations, the uploaded files — and takes the board off everybody's
      // dashboard. The people who were on it are told the same thing they are
      // told about a deletion, because from where they are standing the board
      // has gone; the owner is the one who can bring it back.
      if (!permanent) {
        await db.execute(
          "UPDATE boards SET archivedAt = NOW() WHERE id = ? AND archivedAt IS NULL",
          [id],
        );
        if (auth.viaApiKey) {
          const serverSocket = getServerSocket();
          serverSocket?.to(`board-${id}`).emit("deletedBoard", { boardId: id });
        }
        await notifyDashboards(db, id, memberIds);
        return { message: "Board archived successfully" };
      }

      // Delete all invitations associated with the board
      // The board with everything on it. The same call the nightly archive
      // sweep makes, so what a person destroys here and what the sweep destroys
      // on its own cannot drift apart.
      if (!(await removeBoardCompletely(db, Number(id)))) {
        event.res.statusCode = 404;
        return { error: "Resource not found or already deleted" };
      }

      // Emit socket event for board deletion (API calls only)
      if (auth.viaApiKey) {
        const serverSocket = getServerSocket();
        if (serverSocket) {
          serverSocket.to(`board-${id}`).emit("deletedBoard", {
            boardID: id,
          });
        }
      }

      // Every dashboard that carried a tile for it drops the tile.
      await notifyDashboards(db, id, memberIds);

      return { message: "Board deleted successfully" };
    } else if (method === "PATCH") {
      // Handle PATCH request to update area order
      const { boardId, areas } = await readBody(event);

      // HIGH FIX: Validate areas (boardId is validated by requireBoardAccess)
      if (!areas || !Array.isArray(areas)) {
        event.res.statusCode = 400;
        return {
          error: "Invalid request parameters",
        };
      }

      // Reordering areas requires write access (owner / edit-invite / public).
      const auth = await requireBoardAccess(event, boardId, "edit");
      if (!auth.ok) {
        event.res.statusCode = auth.status;
        return { error: auth.error };
      }

      try {
        // Update the order of areas in the database
        for (let i = 0; i < areas.length; i++) {
          const area = areas[i];
          const [result] = await db.execute(
            "UPDATE areas SET sort = ? WHERE id = ? AND board = ?",
            [i, area.id, boardId],
          );

          if (result.affectedRows === 0) {
            event.res.statusCode = 404;
            return {
              error: "Resource not found or access denied",
            };
          }
        }

        // Fetch updated areas to emit
        const [updatedAreas] = await db.execute(
          "SELECT * FROM areas WHERE board = ? ORDER BY sort",
          [boardId],
        );

        // Emit socket event for area order update (API calls only)
        if (auth.viaApiKey) {
          const serverSocket = getServerSocket();
          if (serverSocket) {
            serverSocket.to(`board-${boardId}`).emit("updateAreas", {
              areas: updatedAreas,
              boardId,
            });
          }
        }

        return { message: "Area order updated successfully" };
      } catch (error) {
        logger.error("Error updating area order:", error);
        event.res.statusCode = 500;
        return { error: "Internal server error" };
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
