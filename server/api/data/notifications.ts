// A person's own notifications: every query is the caller's and nobody else's.
export default dataHandler({
  async GET({ db, query, userId }) {
    // Which cards still have something unread on them. The board page draws a
    // marker on those tiles, and read the entire notification history to work
    // it out — every message, every actor's avatar, the lot, to end up with a
    // handful of ids. This answers that question and nothing else.
    if (query.unreadCards !== undefined) {
      const conditions = [
        "`userId` = ?",
        "`isRead` = 0",
        "`cardId` IS NOT NULL",
      ];
      const params: any[] = [userId];

      // Scoped to one board when asked, which is how the board page asks.
      if (query.boardId !== undefined) {
        conditions.push("`boardId` = ?");
        params.push(positiveId(query.boardId, "Invalid board ID"));
      }

      const [rows]: any = await db.execute(
        `SELECT DISTINCT \`cardId\` FROM \`notifications\` WHERE ${conditions.join(" AND ")}`,
        params,
      );
      return { cardIds: rows.map((row: any) => Number(row.cardId)) };
    }

    // How many to send. Without `limit` the whole history goes out, which is
    // what the board page wants — it reads every unread notification to decide
    // which cards to mark — so the page size is asked for rather than imposed,
    // and an old caller keeps the answer it always got.
    const asked = Number(query.limit);
    const limit =
      Number.isFinite(asked) && asked > 0 ? Math.min(Math.floor(asked), 100) : null;

    // Where to carry on from: the id of the last row the caller already has.
    // Keyed on the row itself rather than on an offset, so notifications
    // arriving while someone reads cannot shift the window and show them a
    // page they have already seen, or skip one they have not.
    const cursor = Number(query.before);
    const conditions = ["n.userId = ?"];
    const params: any[] = [userId];

    if (Number.isFinite(cursor) && cursor > 0) {
      const [anchor]: any = await db.execute(
        "SELECT `createdAt`, `id` FROM `notifications` WHERE `id` = ? AND `userId` = ?",
        [cursor, userId],
      );
      // Two notifications can share a timestamp, so the id settles the order
      // within a second — the same pair the rows are sorted by.
      if (anchor[0]) {
        conditions.push("(n.createdAt < ? OR (n.createdAt = ? AND n.id < ?))");
        params.push(anchor[0].createdAt, anchor[0].createdAt, anchor[0].id);
      }
    }

    // Join the actor's profile so the list can show who did it, with their
    // avatar. actorId is NULL for system notifications (due reminders) and
    // for rows created before that column existed — the UI falls back to the
    // name embedded in the message.
    //
    // One more row than asked for is read: whether it came back is the answer
    // to "is there anything older?", without counting the whole table.
    const [rows]: any = await db.execute(
      `SELECT n.*, u.name AS actorName, u.image AS actorImage, u.type AS actorType
         FROM notifications n
         LEFT JOIN \`user\` u ON u.id = n.actorId
        WHERE ${conditions.join(" AND ")}
        ORDER BY n.createdAt DESC, n.id DESC` +
        // Interpolated, not bound: MySQL refuses a placeholder in LIMIT on a
        // prepared statement. It is a positive integer of at most three
        // digits by the time it gets here.
        (limit ? ` LIMIT ${limit + 1}` : ""),
      params,
    );

    const hasMore = limit !== null && rows.length > limit;
    if (hasMore) rows.length = limit;

    // Counted in the database rather than taken from the rows above: the bell
    // shows a page at a time, and its dot has to answer for the unread ones
    // that are not on screen.
    const [unread]: any = await db.execute(
      "SELECT COUNT(*) AS count FROM `notifications` WHERE `userId` = ? AND `isRead` = 0",
      [userId],
    );

    return {
      notifications: rows,
      hasMore,
      unreadCount: Number(unread[0]?.count ?? 0),
    };
  },

  async PATCH({ db, query, userId }) {
    // Mark read when the user opens a card: all of their notifications for
    // that card (comment, moved, status change, due, assigned, …).
    if (query.cardId !== undefined) {
      await db.execute(
        "UPDATE notifications SET isRead = TRUE WHERE userId = ? AND cardId = ?",
        [userId, positiveId(query.cardId, "Invalid card ID")],
      );
      return { message: "Card notifications marked as read" };
    }

    // Mark read when the user opens a board: only the board-level (non-card)
    // notifications, e.g. invitations. Card notifications stay unread until
    // the card itself is opened.
    if (query.boardId !== undefined) {
      await db.execute(
        "UPDATE notifications SET isRead = TRUE WHERE userId = ? AND boardId = ? AND cardId IS NULL",
        [userId, positiveId(query.boardId, "Invalid board ID")],
      );
      return { message: "Board notifications marked as read" };
    }

    // One notification by its id. The app marks a card's or a board's at
    // once, but this is in the API documentation, so it stays.
    await db.execute(
      "UPDATE notifications SET isRead = TRUE WHERE id = ? AND userId = ?",
      [positiveId(query.id, "Invalid notification ID"), userId],
    );
    return { message: "Notification marked as read" };
  },
});
