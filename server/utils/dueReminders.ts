import { getBoardMemberIds } from "./boardMembers";

// Create in-app `card_due` notifications for every reminder whose fire time
// (dueDate - minutesBefore) has arrived and that hasn't fired yet. The existing
// hourly `notification` task then emails any unread ones.
//
// Recipients:
//   - assigned card   → only the assignee
//   - unassigned card → the board owner + all invited users
//
// Takes the connection pool as a parameter so it can be tested against a real
// database. Returns the number of reminders fired.
export async function runDueReminders(db: any): Promise<number> {
  // Skip due dates already more than a day in the past, so setting an old date
  // doesn't spam long-overdue reminders.
  const [rows]: any = await db.execute(
    `SELECT r.id AS reminderId, c.id AS cardId, c.name AS cardName,
            c.dueDate AS dueDate, c.assignee AS assignee, a.board AS boardId
       FROM card_reminders r
       JOIN cards c ON c.id = r.card
       JOIN areas a ON a.id = c.area
       JOIN boards b ON b.id = a.board
      WHERE r.notified = 0
        -- Nothing archived is anybody's problem any more: a card put away, a
        -- column put away with its cards in it, or a whole board. The reminder
        -- rows stay, so restoring brings the reminders back with the card.
        AND c.archivedAt IS NULL
        AND a.archivedAt IS NULL
        AND b.archivedAt IS NULL
        AND c.dueDate IS NOT NULL
        AND NOW() >= (c.dueDate - INTERVAL r.minutesBefore MINUTE)
        AND c.dueDate >= (NOW() - INTERVAL 1 DAY)`,
  );

  for (const r of rows as any[]) {
    const recipients = r.assignee
      ? [r.assignee]
      : await getBoardMemberIds(db, r.boardId);

    // Store the due date as ISO so the notification translators (UI + email)
    // can localise it.
    const message = `Card "${r.cardName}" is due on ${new Date(
      r.dueDate,
    ).toISOString()}`;

    for (const memberId of recipients) {
      await db.execute(
        "INSERT INTO notifications (userId, type, boardId, cardId, message) VALUES (?, ?, ?, ?, ?)",
        [memberId, "card_due", r.boardId, r.cardId, message],
      );
    }

    await db.execute("UPDATE card_reminders SET notified = 1 WHERE id = ?", [
      r.reminderId,
    ]);
  }

  return (rows as any[]).length;
}
