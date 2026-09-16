// One comment, one place in the list.
//
// A comment can reach the open card twice: the answer to your own POST puts it
// there, and a moment later the same comment may arrive again — from this card's
// socket room, or from the copy the card dialog keeps and hands back when the
// section is rebuilt. Each of those paths is right on its own; together they
// showed the comment twice until the next reload, which is confusing in a place
// where people are talking to each other.
//
// So insertion goes through here, and what is rendered goes through here.

export interface WithId {
  id: number | string;
}

const sameComment = (a: WithId, b: WithId) => String(a.id) === String(b.id);

/**
 * The list with this comment in it, once. An id that is already there wins —
 * the copy on screen may carry edits the arriving one does not.
 */
export function withComment<T extends WithId>(list: T[], comment: T): T[] {
  if (!comment || comment.id === undefined || comment.id === null) return list;
  return list.some((existing) => sameComment(existing, comment))
    ? list
    : [comment, ...list];
}

/** The list with every id kept once, in the order it first appears. */
export function uniqueComments<T extends WithId>(list: T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const comment of list ?? []) {
    const key = String(comment?.id);
    if (comment?.id === undefined || comment?.id === null || seen.has(key)) continue;
    seen.add(key);
    unique.push(comment);
  }
  return unique;
}
