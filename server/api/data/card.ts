import { defineEventHandler, readBody, getQuery } from "h3";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { pruneUnusedLabels } from "../../utils/labelCleanup";
import { dispatchWebhooks } from "../../utils/webhooks";
import { getServerSocket } from "../../utils/socket";

// Function to handle file uploads
async function handleFileUpload(db, cardID, file) {
  const { filename, filetype, filesize, filedata } = file;

  // Insert the file into the attachments table
  const [result] = await db.execute(
    "INSERT INTO attachments (card, filename, filetype, filesize, filedata) VALUES (?, ?, ?, ?, ?)",
    [cardID, filename, filetype, filesize, filedata],
  );

  return result.insertId;
}

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
      // Handle GET request to fetch card details
      const { cardID } = getQuery(event);

      // HIGH FIX: Validate cardId is a positive integer
      const cardId = Array.isArray(cardID) ? cardID[0] : cardID;
      if (!cardId || isNaN(Number(cardId)) || Number(cardId) <= 0) {
        event.res.statusCode = 400;
        return { error: "Invalid card ID" };
      }

      // Fetch card details
      const [rows] = await db.execute("SELECT * FROM cards WHERE id = ?", [
        cardId,
      ]);
      const card = rows[0];

      if (!card) {
        // HIGH FIX: Generic error to prevent card enumeration
        event.res.statusCode = 404;
        return { error: "Resource not found" };
      }

      const [boardRows] = await db.execute(
        "SELECT b.* FROM boards b JOIN areas a ON b.id = a.board WHERE a.id = ?",
        [card.area],
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
        // Convert status from number to boolean
        card.status = !!card.status;

        // Fetch attachments for the card
        const [attachmentRows] = await db.execute(
          "SELECT id, filename, filetype, filesize, filedata FROM attachments WHERE card = ?",
          [cardId],
        );
        const attachments = attachmentRows.map((row) => ({
          id: row.id,
          filename: row.filename,
          filetype: row.filetype,
          filesize: row.filesize,
          filedata: row.filedata,
        }));

        // Reminder schedule (minutes-before-due offsets).
        const [reminderRows]: any = await db.execute(
          "SELECT minutesBefore FROM card_reminders WHERE card = ? ORDER BY minutesBefore ASC",
          [cardId],
        );
        card.reminders = (reminderRows as any[]).map((r) => r.minutesBefore);

        // The labels themselves, not just their ids: they are what the card
        // shows and what it hands back to the tile behind it.
        const [labelRows]: any = await db.execute(
          `SELECT l.id, l.name
             FROM \`card_labels\` cl JOIN \`labels\` l ON l.id = cl.label
            WHERE cl.card = ? ORDER BY l.sort ASC, l.id ASC`,
          [cardId],
        );
        card.labels = labelRows;

        return { card, attachments };
      }
    } else if (method === "POST") {
      // Handle POST request to create a new card
      const { areaId, name, content, status } = await readBody(event);

      // HIGH FIX: Validate required fields with generic message
      if (!areaId || !name) {
        event.res.statusCode = 400;
        return { error: "Required fields are missing" };
      }

      // HIGH FIX: Validate areaId is a positive integer
      if (isNaN(Number(areaId)) || Number(areaId) <= 0) {
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

      const writeDecision = await authorizeBoard(db, board, userId, "edit");
      if (!writeDecision.ok) {
        event.res.statusCode = writeDecision.status;
        return { error: writeDecision.error };
      }
      {
        const [crows] = await db.execute("SELECT * FROM cards WHERE area = ?", [
          areaId,
        ]);

        const cardCount = crows ? crows.length + 1 : 0;

        // Create new card
        const [result] = await db.execute(
          "INSERT INTO cards (area, name, content, status, sort) VALUES (?, ?, ?, ?, ?)",
          [areaId, name, content || "", status ? 1 : 0, cardCount],
        );

        const [rows] = await db.execute("SELECT * FROM cards WHERE id = ?", [
          result.insertId,
        ]);
        const card = rows[0];

        // Fetch all users who have access to the board (owner and invited users)
        const [boardRows] = await db.execute(
          "SELECT user, id AS boardId, name FROM boards WHERE id = (SELECT board FROM areas WHERE id = ?)",
          [areaId],
        );
        const boardOwner = boardRows[0]?.user;
        const boardId = boardRows[0]?.boardId;

        const [invitedUsers] = await db.execute(
          "SELECT user FROM invitations WHERE board = (SELECT board FROM areas WHERE id = ?)",
          [areaId],
        );

        // Create notifications for the board owner and invited users
        // CRITICAL FIX: Use authenticated userId instead of body user
        const usersToNotify = [
          boardOwner,
          ...invitedUsers.map((inv) => inv.user),
        ].filter(Boolean);

        // Get the creating user's name and board name for the notification
        const [userRows]: any = await db.execute(
          "SELECT name FROM user WHERE id = ?",
          [userId],
        );
        const username = userRows[0]?.name || "Unknown user";

        const boardName = boardRows[0]?.name || "Unknown board";

        for (const notifyUserId of usersToNotify) {
          if (notifyUserId !== userId) {
            // Don't notify the authenticated user who created the card
            await db.execute(
              "INSERT INTO notifications (userId, type, boardId, cardId, message, actorId) VALUES (?, ?, ?, ?, ?, ?)",
              [
                notifyUserId,
                "card_created",
                boardId,
                card.id,
                `"${username}" created a new card "${card.name}" on board "${boardName}"`,
                              userId,
              ],
            );
          }
        }

        await recordCardActivity(card.id, "created", userId);

        // Emit socket event for card creation (only for API calls, not frontend)
        if (auth.viaApiKey) {
          const serverSocket = getServerSocket();
          serverSocket.to(`board-${boardRows[0]?.boardId}`).emit("addCard", {
            boardId: boardRows[0]?.boardId,
            card: rows[0],
          });
        }

        dispatchWebhooks({
          boardId: boardRows[0]?.boardId,
          event: "card.created",
          actorUserId: userId,
          card: { id: card?.id, name: card?.name, areaId: card?.area },
        });

        return { card };
      }
    } else if (method === "PUT") {
      // Handle PUT request to update an existing card
      const { cardID, name, content, status, files, dueDate, assignee, reminders, labelIds } =
        await readBody(event);

      // HIGH FIX: Validate required fields with generic message
      if (!cardID || !name) {
        event.res.statusCode = 400;
        return { error: "Required fields are missing" };
      }

      // HIGH FIX: Validate cardID is a positive integer
      if (isNaN(Number(cardID)) || Number(cardID) <= 0) {
        event.res.statusCode = 400;
        return { error: "Invalid card ID" };
      }

      // Fetch card details
      const [rows] = await db.execute("SELECT * FROM cards WHERE id = ?", [
        cardID,
      ]);
      const card = rows[0];

      if (!card) {
        // HIGH FIX: Generic error to prevent card enumeration
        event.res.statusCode = 404;
        return { error: "Resource not found" };
      }

      const [boardRows] = await db.execute(
        "SELECT b.* FROM boards b JOIN areas a ON b.id = a.board WHERE a.id = ?",
        [card.area],
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
        // Fetch the original card to check if status changed
        const [originalCardRows] = await db.execute(
          "SELECT * FROM cards WHERE id = ?",
          [cardID],
        );
        const originalCard = originalCardRows[0];
        const originalStatus = !!originalCard.status;
        const newStatus = !!status;

        // Normalize the new due date / assignee.
        const newDue = dueDate ? new Date(dueDate) : null;
        const newAssignee = assignee || null;
        const oldDue = originalCard.dueDate
          ? new Date(originalCard.dueDate)
          : null;
        const dueChanged =
          (newDue ? newDue.getTime() : null) !==
          (oldDue ? oldDue.getTime() : null);

        // Update the card
        await db.execute(
          "UPDATE cards SET name = ?, content = ?, status = ?, dueDate = ?, assignee = ? WHERE id = ?",
          [name, content || "", status ? 1 : 0, newDue, newAssignee, cardID],
        );

        // Sync the reminder schedule when the client provided one, preserving
        // the `notified` flag of reminders that stay unchanged.
        if (Array.isArray(reminders)) {
          const wanted = [
            ...new Set(
              reminders
                .map((m: any) => Number(m))
                .filter((m: number) => Number.isFinite(m) && m >= 0),
            ),
          ];
          const [existingRem]: any = await db.execute(
            "SELECT minutesBefore FROM card_reminders WHERE card = ?",
            [cardID],
          );
          const existing = new Set(
            (existingRem as any[]).map((r) => r.minutesBefore),
          );
          for (const m of existing) {
            if (!wanted.includes(m)) {
              await db.execute(
                "DELETE FROM card_reminders WHERE card = ? AND minutesBefore = ?",
                [cardID, m],
              );
            }
          }
          for (const m of wanted) {
            if (!existing.has(m)) {
              await db.execute(
                "INSERT INTO card_reminders (card, minutesBefore, notified) VALUES (?, ?, 0)",
                [cardID, m],
              );
            }
          }
        }

        // Which labels this card wears, when the client says. Absent means
        // "leave them alone" — the same contract as `reminders` above, so a
        // caller that knows nothing about labels cannot strip them by omission.
        //
        // Only labels belonging to this card's own board are accepted, so a
        // card cannot be made to wear another board's names by id.
        if (Array.isArray(labelIds)) {
          const wanted = [
            ...new Set(
              labelIds
                .map((id: any) => Number(id))
                .filter((id: number) => Number.isFinite(id) && id > 0),
            ),
          ];

          // Names are collected alongside the ids because the history is
          // written from them, and a word that is about to be swept would be
          // gone by the time the entry was written.
          const nameById = new Map<number, string>();
          const allowed: number[] = [];
          if (wanted.length > 0) {
            const placeholders = wanted.map(() => "?").join(",");
            const [ownRows]: any = await db.execute(
              `SELECT \`id\`, \`name\` FROM \`labels\` WHERE board = ? AND id IN (${placeholders})`,
              [board.id, ...wanted],
            );
            for (const row of ownRows as any[]) {
              allowed.push(Number(row.id));
              nameById.set(Number(row.id), String(row.name));
            }
          }

          // What it wore before, so anything it is putting down can be swept
          // if no other card picked it up. A label exists because a card uses
          // it; the last card to drop a name takes the name with it, and the
          // next card to type that word makes it again.
          const [wornRows]: any = await db.execute(
            "SELECT l.`id`, l.`name` FROM `card_labels` cl JOIN `labels` l ON l.id = cl.label WHERE cl.`card` = ?",
            [cardID],
          );
          const before: number[] = [];
          for (const row of wornRows as any[]) {
            before.push(Number(row.id));
            nameById.set(Number(row.id), String(row.name));
          }

          await db.execute("DELETE FROM `card_labels` WHERE `card` = ?", [
            cardID,
          ]);
          for (const labelId of allowed) {
            await db.execute(
              "INSERT INTO `card_labels` (`card`, `label`) VALUES (?, ?)",
              [cardID, labelId],
            );
          }

          // Labelling a card is a change to it, so it belongs in the card's own
          // history beside the due date and the assignee. Not in the
          // notifications: nobody needs telling by e-mail that a card is now
          // marked "Bug", and the history is where you look to find out.
          const added = allowed.filter((id) => !before.includes(id));
          const removed = before.filter((id) => !allowed.includes(id));
          if (added.length || removed.length) {
            const named = (ids: number[]) =>
              ids.map((id) => nameById.get(id)).filter(Boolean);
            await recordCardActivity(cardID, "labels", userId, {
              added: named(added),
              removed: named(removed),
            });
          }

          await pruneUnusedLabels(db, removed);
        }

        // A changed due date means the reminders should fire again.
        if (dueChanged) {
          await recordCardActivity(cardID, "due", userId, {
            dueDate: dueDate || null,
          });
          await db.execute(
            "UPDATE card_reminders SET notified = 0 WHERE card = ?",
            [cardID],
          );
        }

        // Notify a newly assigned user (not when clearing, re-saving the same
        // assignee, or assigning yourself).
        if (
          newAssignee &&
          newAssignee !== (originalCard.assignee || null) &&
          newAssignee !== userId
        ) {
          const [assignerRows]: any = await db.execute(
            "SELECT name FROM user WHERE id = ?",
            [userId],
          );
          const assignerName = assignerRows[0]?.name || "Someone";
          await recordCardActivity(cardID, "assigned", userId, {
            assigneeId: newAssignee,
          });
          await db.execute(
            "INSERT INTO notifications (userId, type, boardId, cardId, message, actorId) VALUES (?, ?, ?, ?, ?, ?)",
            [
              newAssignee,
              "card_assigned",
              board.id,
              cardID,
              `"${assignerName}" assigned you the card "${name}"`,
                            userId,
              ],
          );
        }

        // Handle file uploads if present
        let newAttachments = [];
        if (files && Array.isArray(files)) {
          for (const file of files) {
            const attachmentId = await handleFileUpload(db, cardID, file);
            newAttachments.push(attachmentId);
          }
        }

        // Fetch the updated card with comment and attachment counts
        const [rows] = await db.execute(
          "SELECT c.*, (SELECT COUNT(*) FROM comments co WHERE co.card = c.id) as commentCount, (SELECT COUNT(*) FROM attachments a WHERE a.card = c.id) as attachmentCount FROM cards c WHERE c.id = ?",
          [cardID],
        );
        const card = rows[0];

        if (!card) {
          // HIGH FIX: Generic error to prevent card enumeration
          event.res.statusCode = 404;
          return { error: "Resource not found" };
        }

        // Convert status from number to boolean
        card.status = !!card.status;

        // Attach the reminder schedule to the returned card.
        const [cardReminderRows]: any = await db.execute(
          "SELECT minutesBefore FROM card_reminders WHERE card = ? ORDER BY minutesBefore ASC",
          [cardID],
        );
        card.reminders = (cardReminderRows as any[]).map((r) => r.minutesBefore);

        // Create notification if status changed
        if (originalStatus !== newStatus) {
          // Fetch all users who have access to the board (owner and invited users)
          const [boardRows] = await db.execute(
            "SELECT user, id AS boardId FROM boards WHERE id = (SELECT board FROM areas WHERE id = ?)",
            [card.area],
          );
          const boardOwner = boardRows[0]?.user;
          const boardId = boardRows[0]?.boardId;

          const [invitedUsers] = await db.execute(
            "SELECT user FROM invitations WHERE board = (SELECT board FROM areas WHERE id = ?)",
            [card.area],
          );

          // Create notifications for the board owner and invited users
          const usersToNotify = [
            boardOwner,
            ...invitedUsers.map((inv) => inv.user),
          ].filter(Boolean);

          await recordCardActivity(cardID, "status", userId, {
            done: !!newStatus,
          });
          const statusText = newStatus ? "completed" : "reopened";
          const notificationMessage = `Card "${card.name}" status changed to ${statusText}`;

          for (const notifyUserId of usersToNotify) {
            if (notifyUserId !== userId) {
              // Don't notify the user who changed the status
              await db.execute(
                "INSERT INTO notifications (userId, type, boardId, cardId, message, actorId) VALUES (?, ?, ?, ?, ?, ?)",
                [
                  notifyUserId,
                  "card_status_changed",
                  boardId,
                  card.id,
                  notificationMessage,
                                userId,
              ],
              );
            }
          }
        }

        // Fetch the new attachments if any were added
        let attachments = [];
        if (newAttachments.length > 0) {
          const [attachmentRows] = await db.execute(
            "SELECT id, filename, filetype, filesize, filedata FROM attachments WHERE id IN (?)",
            [newAttachments.join(",")],
          );
          attachments = attachmentRows.map((row) => ({
            id: row.id,
            filename: row.filename,
            filetype: row.filetype,
            filesize: row.filesize,
            filedata: row.filedata,
          }));
        }

        // The labels it wears now. The answer carries them, and so does the
        // broadcast built from it, so another client showing this card is
        // told what changed rather than left with what it had.
        const [currentLabels]: any = await db.execute(
          `SELECT l.id, l.name
             FROM \`card_labels\` cl JOIN \`labels\` l ON l.id = cl.label
            WHERE cl.card = ? ORDER BY l.sort ASC, l.id ASC`,
          [cardID],
        );
        card.labels = currentLabels;

        // Emit socket event for card update (only for API calls, not frontend)
        if (auth.viaApiKey) {
          const serverSocket = getServerSocket();
          serverSocket.to(`board-${boardRows[0]?.boardId}`).emit("updateCard", {
            boardId: boardRows[0]?.boardId,
            attachments: attachments,
            card: rows[0],
          });
        }

        dispatchWebhooks({
          boardId: board?.id,
          event: "card.updated",
          actorUserId: userId,
          card: { id: card?.id, name: card?.name, done: !!card?.status },
        });

        return { card, attachments };
      }
    } else if (method === "DELETE") {
      // Handle DELETE request: archives the card, or removes it for good when
      // the caller asks for that explicitly.
      const { cardID, permanent } = await readBody(event);

      // HIGH FIX: Validate cardID is a positive integer
      if (!cardID || isNaN(Number(cardID)) || Number(cardID) <= 0) {
        event.res.statusCode = 400;
        return { error: "Invalid card ID" };
      }

      // Fetch card details
      const [rows] = await db.execute("SELECT * FROM cards WHERE id = ?", [
        cardID,
      ]);
      const card = rows[0];

      if (!card) {
        // HIGH FIX: Generic error to prevent card enumeration
        event.res.statusCode = 404;
        return { error: "Resource not found" };
      }

      const [boardRows] = await db.execute(
        "SELECT b.* FROM boards b JOIN areas a ON b.id = a.board WHERE a.id = ?",
        [card.area],
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
      // Archiving is what a delete does now. The card comes off the board and
      // keeps everything it has — its comments, its files, its history — so it
      // can be put back exactly as it was. Only the archive itself asks for
      // `permanent`, and that is the old, unrecoverable path below.
      if (!permanent) {
        if (!card.archivedAt) {
          await db.execute(
            "UPDATE cards SET archivedAt = NOW() WHERE id = ? AND archivedAt IS NULL",
            [cardID],
          );
          await recordCardActivity(cardID, "archived", userId);
        }

        // It has left the board, which is what every other client needs to
        // know; whether it was destroyed or filed away is this endpoint's
        // business, not theirs.
        if (auth.viaApiKey) {
          const serverSocket = getServerSocket();
          serverSocket.to(`board-${boardRows[0]?.id}`).emit("deletedCard", {
            boardId: boardRows[0]?.id,
            card,
          });
        }
        return { message: "Card archived successfully", card };
      }

      {
        // Everything that hung off the card — its comments, its attachments and
        // the files behind them, its reminders, its activity and its
        // notifications. See `removeCardData`: this used to take the comments
        // and the notifications only, and leave the rest behind for ever.
        await removeCardData(db, [Number(cardID)]);

        // Delete Card
        const [result] = await db.execute("DELETE FROM cards WHERE id = ?", [
          cardID,
        ]);

        if (result.affectedRows === 0) {
          // HIGH FIX: Generic error to prevent card enumeration
          event.res.statusCode = 404;
          return { error: "Resource not found or already deleted" };
        }

        // Emit socket event for card deletion (only for API calls, not frontend)
        if (auth.viaApiKey) {
          const serverSocket = getServerSocket();
          serverSocket.to(`board-${boardRows[0]?.id}`).emit("deletedCard", {
            boardId: boardRows[0]?.id,
            card: card,
          });
        }

        return { message: "Card deleted successfully", card: card };
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
