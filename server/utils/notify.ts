import { getBoardMemberIds } from "./boardMembers";

// Notifications are stored as English sentences of a fixed shape, which the
// bell (app/components/NotificationItem.vue) and the e-mail digest
// (server/tasks/notification.ts) take apart again to say them in the reader's
// language. So every notification is written with one of these and never by
// hand: a sentence in any other shape reaches the reader untranslated, or with
// its comment missing — which is what the MCP tools' own wording did.
export const notificationText = {
  cardCreated: (actorName: string, cardName: string, boardName: string) =>
    `"${actorName}" created a new card "${cardName}" on board "${boardName}"`,
  cardMoved: (cardName: string, from: string, to: string) =>
    `Card "${cardName}" moved from "${from}" to "${to}"`,
  cardStatus: (cardName: string, done: boolean) =>
    `Card "${cardName}" status changed to ${done ? "completed" : "reopened"}`,
  comment: (actorName: string, cardName: string, content: string) =>
    `New comment by "${actorName}" on card "${cardName}": ${content}`,
  cardAssigned: (actorName: string, cardName: string) =>
    `"${actorName}" assigned you the card "${cardName}"`,
  cardDue: (cardName: string, due: Date) =>
    `Card "${cardName}" is due on ${due.toISOString()}`,
};

export type NotificationType =
  | "card_created"
  | "card_moved"
  | "card_status_changed"
  | "comment"
  | "card_assigned"
  | "card_due";

interface Notification {
  type: NotificationType;
  boardId: number | string;
  cardId: number | string | null;
  message: string;
  /** Who did it; null for the app's own, like a due reminder. */
  actorId: string | null;
}

/** One notification for one person. */
export async function notifyUser(
  db: any,
  userId: string,
  { type, boardId, cardId, message, actorId }: Notification,
): Promise<void> {
  await db.execute(
    "INSERT INTO notifications (userId, type, boardId, cardId, message, actorId) VALUES (?, ?, ?, ?, ?, ?)",
    [userId, type, boardId, cardId, message, actorId],
  );
}

/**
 * Something that happened on a board, for everyone on it — the owner and
 * everyone invited — except whoever did it.
 */
export async function notifyBoard(
  db: any,
  notification: Notification,
): Promise<void> {
  for (const userId of await getBoardMemberIds(db, notification.boardId)) {
    if (userId !== notification.actorId) {
      await notifyUser(db, userId, notification);
    }
  }
}

/** The name a notification calls somebody by. */
export async function nameOf(db: any, userId: string): Promise<string> {
  const [rows]: any = await db.execute("SELECT name FROM user WHERE id = ?", [
    userId,
  ]);
  return rows[0]?.name || "Someone";
}
