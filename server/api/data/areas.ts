import { defineEventHandler, getQuery } from "h3";
import { setupDatabase } from "../../../app/lib/databaseSetup";

export default defineEventHandler(async (event) => {
  // Check the HTTP method
  const method = event.req.method;

  try {
    // Initialize database
    const db = setupDatabase();

    if (method === "GET") {
      // Handle GET request to fetch areas
      const query = getQuery(event);
      const boardId = query.boardId;

      // Resolve auth + read access (validates boardId, loads board).
      const auth = await requireBoardAccess(event, boardId, "read");
      if (!auth.ok) {
        event.res.statusCode = auth.status;
        return { error: auth.error };
      }

      const [rows] = await db.execute(
        "SELECT * FROM areas WHERE board = ? AND archivedAt IS NULL ORDER BY sort ASC",
        [boardId],
      );

      return { areas: rows };
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
