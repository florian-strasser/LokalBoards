import { readBody } from "h3";
import { onlyTicksChanged } from "../../utils/commentChecklist";
import {
  addComment,
  changeComment,
  commentById,
  commentsOn,
  removeComment,
} from "../../utils/comments";

// The comment asked for, with access to its card's board decided at `level`.
async function commentOf(
  db: any,
  id: unknown,
  cardOf: (id: unknown, level: "read" | "edit") => Promise<any>,
  level: "read" | "edit",
) {
  const comment = await commentById(db, positiveId(id, "Invalid comment ID"));
  if (!comment) fail(404, "Resource not found");
  await cardOf(comment.card, level);
  return comment;
}

export default dataHandler({
  // A card's comments, newest first.
  async GET({ db, query, cardOf }) {
    const { card } = await cardOf(query.cardID, "read");
    return { comments: await commentsOn(db, card.id) };
  },

  async POST({ event, db, userId, viaApiKey, cardOf }) {
    const { card, content } = await readBody(event);
    if (!card || !content) fail(400, "Required fields are missing");
    const found = await cardOf(card, "edit");
    return { comment: await addComment(db, found, userId, content, viaApiKey) };
  },

  // A box in a comment's checklist ticked or unticked. Anybody who may edit
  // the board can do that to anybody's comment, so it may change the ticks
  // and nothing else (see onlyTicksChanged).
  async PATCH({ event, db, viaApiKey, cardOf }) {
    const { id, content, cardId } = await readBody(event);
    if (!id || !content || !cardId) fail(400, "Required fields are missing");
    const comment = await commentOf(db, id, cardOf, "edit");
    if (comment.card !== positiveId(cardId, "Invalid ID")) {
      fail(400, "Comment does not belong to specified card");
    }
    if (!onlyTicksChanged(comment.content, content)) {
      fail(400, "Only checkbox states can be modified");
    }
    return { comment: await changeComment(db, comment, content, viaApiKey) };
  },

  // A comment changed by whoever wrote it.
  async PUT({ event, db, userId, viaApiKey, cardOf }) {
    const { id, content } = await readBody(event);
    if (!id || !content) fail(400, "Required fields are missing");
    const comment = await commentOf(db, id, cardOf, "read");
    if (comment.user !== userId) fail(403, "Unauthorized access");
    return { comment: await changeComment(db, comment, content, viaApiKey) };
  },

  // A comment taken back by whoever wrote it.
  async DELETE({ db, query, userId, viaApiKey, cardOf }) {
    const comment = await commentOf(db, query.commentId, cardOf, "read");
    if (comment.user !== userId) fail(403, "Unauthorized access");
    await removeComment(db, comment, viaApiKey);
    return { success: true };
  },
});
