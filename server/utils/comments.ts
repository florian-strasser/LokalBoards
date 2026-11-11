import { notificationText, notifyBoard } from "./notify";
import { emitToCard } from "./socket";
import { dispatchWebhooks } from "./webhooks";

// A comment read, written, changed or removed: the one way each is done for
// the app, the REST API and MCP alike. Access is the caller's to check first
// (see access.ts); `broadcast` is whether to tell whoever has the card open —
// a browser tells the others itself.

// Who wrote it is the account's name, or — for a comment that came with an
// import, or whose account is gone — the name it was written under.
const COMMENTS = `SELECT comments.id, comments.card, comments.user,
  COALESCE(user.name, comments.authorName) AS userName, user.image AS userImage,
  comments.content, comments.date
  FROM comments LEFT JOIN user ON comments.user = user.id`;

const shape = (row: any) => ({
  id: row.id,
  card: row.card,
  user: row.user,
  userImage: row.userImage,
  userName: row.userName || "Unknown User",
  content: row.content,
  date: row.date,
});

/** The comments of each of these cards, newest first, by card. */
export async function commentsOnCards(db: any, cardIds: number[]) {
  const byCard = new Map<number, ReturnType<typeof shape>[]>();
  if (!cardIds.length) return byCard;
  const [rows]: any = await db.query(
    `${COMMENTS} WHERE comments.card IN (?) ORDER BY comments.date DESC, comments.id DESC`,
    [cardIds],
  );
  for (const row of rows) {
    const list = byCard.get(row.card) ?? [];
    list.push(shape(row));
    byCard.set(row.card, list);
  }
  return byCard;
}

/** A card's comments, newest first. */
export async function commentsOn(db: any, cardId: number) {
  return (await commentsOnCards(db, [cardId])).get(cardId) ?? [];
}

export async function commentById(db: any, id: number) {
  const [rows]: any = await db.execute(`${COMMENTS} WHERE comments.id = ?`, [id]);
  return rows[0] ? shape(rows[0]) : null;
}

/** A new comment, and everyone on the board told. */
export async function addComment(
  db: any,
  { card, board }: { card: any; board: any },
  actorId: string,
  content: string,
  broadcast: boolean,
) {
  const [result]: any = await db.execute(
    "INSERT INTO comments (card, user, content) VALUES (?, ?, ?)",
    [card.id, actorId, content],
  );
  const comment = await commentById(db, result.insertId);
  emitToCard(card.id, "addComment", { comment, cardID: card.id }, broadcast);
  await notifyBoard(db, {
    type: "comment",
    boardId: board.id,
    cardId: card.id,
    message: notificationText.comment(comment.userName, card.name, comment.content),
    actorId,
  });
  dispatchWebhooks({
    boardId: board.id,
    event: "comment.created",
    actorUserId: actorId,
    card: { id: card.id, name: card.name },
    comment: { id: comment.id, content: comment.content ?? "" },
  });
  return comment;
}

export async function changeComment(
  db: any,
  comment: any,
  content: string,
  broadcast: boolean,
) {
  await db.execute("UPDATE comments SET content = ? WHERE id = ?", [content, comment.id]);
  const changed = await commentById(db, comment.id);
  emitToCard(comment.card, "updateComment", { comment: changed, cardID: comment.card }, broadcast);
  return changed;
}

export async function removeComment(db: any, comment: any, broadcast: boolean) {
  await db.execute("DELETE FROM comments WHERE id = ?", [comment.id]);
  emitToCard(comment.card, "deleteComment", { commentId: Number(comment.id), cardID: comment.card }, broadcast);
}
