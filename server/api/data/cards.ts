import { defineEventHandler, getQuery } from "h3";
import { setupDatabase } from "../../../app/lib/databaseSetup";

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

    if (method === "GET") {
      // Handle GET request to fetch cards for a specific area
      const query = getQuery(event);
      const areaId = query.areaId;

      // HIGH FIX: Validate areaId is a positive integer
      if (!areaId || isNaN(Number(areaId)) || Number(areaId) <= 0) {
        event.res.statusCode = 400;
        return { error: "Invalid area ID" };
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

      const decision = await authorizeBoard(db, board, userId, "read");
      if (!decision.ok) {
        event.res.statusCode = decision.status;
        return { error: decision.error };
      }
      {
        // Optional filters (also used by the MCP layer's searchCards):
        //   ?done=true|false      only completed / only open cards
        //   ?assignee=<userId>    only cards assigned to that user
        //   ?unassigned=true      only cards nobody has been assigned
        //   ?dueBefore=<ISO>      only cards due before that timestamp
        const filters: string[] = ["c.area = ?"];
        const params: any[] = [areaId];
        if (query.done !== undefined && query.done !== "") {
          filters.push("c.status = ?");
          params.push(String(query.done) === "true" ? 1 : 0);
        }
        if (String(query.unassigned) === "true") {
          filters.push("c.assignee IS NULL");
        }
        if (query.assignee) {
          filters.push("c.assignee = ?");
          params.push(String(query.assignee));
        }
        if (query.dueBefore) {
          const before = new Date(String(query.dueBefore));
          if (!Number.isNaN(before.getTime())) {
            filters.push("c.dueDate IS NOT NULL AND c.dueDate < ?");
            params.push(before);
          }
        }

        const [cards] = await db.execute(
          `SELECT c.id, c.area, c.name, c.content, c.status, c.sort, c.dueDate, c.assignee, au.name AS assigneeName, au.image AS assigneeImage, au.type AS assigneeType, (SELECT COUNT(*) FROM comments co WHERE co.card = c.id) as commentCount, (SELECT COUNT(*) FROM attachments a WHERE a.card = c.id) as attachmentCount FROM cards c LEFT JOIN user au ON au.id = c.assignee WHERE ${filters.join(" AND ")} ORDER BY c.sort ASC`,
          params,
        );

        // Prefetch comments and attachment metadata for every card so the
        // card modal can render instantly without an extra round trip. The
        // attachment file payload (filedata) is intentionally excluded here to
        // keep the board response lean — it is fetched on download via
        // /api/data/attachment.
        if (cards.length > 0) {
          const cardIds = cards.map((card) => card.id);
          const placeholders = cardIds.map(() => "?").join(",");

          const [commentRows] = await db.execute(
            `SELECT comments.id AS id, comments.card AS card, comments.user AS user, COALESCE(user.name, comments.authorName) AS userName, user.image AS userImage, comments.content AS content, comments.date AS date FROM comments LEFT JOIN user ON comments.user = user.id WHERE comments.card IN (${placeholders}) ORDER BY comments.date DESC`,
            cardIds,
          );

          const [attachmentRows] = await db.execute(
            `SELECT id, card, filename, filetype, filesize FROM attachments WHERE card IN (${placeholders})`,
            cardIds,
          );

          const [reminderRows] = await db.execute(
            `SELECT card, minutesBefore FROM card_reminders WHERE card IN (${placeholders}) ORDER BY minutesBefore ASC`,
            cardIds,
          );
          // Labels for every card on the board in one query, so a tile can
          // draw its chips without the board making a request per card.
          const [labelRows] = await db.execute(
            `SELECT cl.card AS card, l.id, l.name
               FROM \`card_labels\` cl JOIN \`labels\` l ON l.id = cl.label
              WHERE cl.card IN (${placeholders}) ORDER BY l.sort ASC, l.id ASC`,
            cardIds,
          );
          const labelsByCard = new Map();
          for (const row of labelRows) {
            if (!labelsByCard.has(row.card)) labelsByCard.set(row.card, []);
            labelsByCard.get(row.card).push({ id: row.id, name: row.name });
          }

          const remindersByCard = new Map();
          for (const row of reminderRows) {
            if (!remindersByCard.has(row.card))
              remindersByCard.set(row.card, []);
            remindersByCard.get(row.card).push(row.minutesBefore);
          }

          const commentsByCard = new Map();
          for (const row of commentRows) {
            const comment = {
              id: row.id,
              card: row.card,
              user: row.user,
              userImage: row.userImage,
              userName: row.userName || "Unknown User",
              content: row.content,
              date: row.date,
            };
            if (!commentsByCard.has(row.card)) commentsByCard.set(row.card, []);
            commentsByCard.get(row.card).push(comment);
          }

          const attachmentsByCard = new Map();
          for (const row of attachmentRows) {
            if (!attachmentsByCard.has(row.card))
              attachmentsByCard.set(row.card, []);
            attachmentsByCard.get(row.card).push({
              id: row.id,
              filename: row.filename,
              filetype: row.filetype,
              filesize: row.filesize,
            });
          }

          for (const card of cards) {
            card.status = !!card.status;
            card.comments = commentsByCard.get(card.id) || [];
            card.attachments = attachmentsByCard.get(card.id) || [];
            card.reminders = remindersByCard.get(card.id) || [];
            card.labels = labelsByCard.get(card.id) || [];
          }
        }

        return { cards };
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
