import type { ImportBoard } from "./boardImport";

// Reading a Nextcloud Deck export into the shape `boardImport.ts` writes.
//
// Deck has one export, run on the server: `occ deck:export <user>`. It is a
// JSON file with the Deck version and every board that user owns, keyed by id
// — so one file can be several boards, and each comes across as a board of its
// own. Deck 1.19 writes descriptions in Markdown, checklists included, and
// keeps comments with their author's display name; a card is done when it has
// a `done` date. It leaves archived cards and every attachment out of the file
// entirely, so there is nothing of either to bring over (see
// `test/fixtures/import/README.md`).
//
// Deleted and archived boards, stacks and cards stay behind. People are not
// carried over: comments keep their author's name.

const values = (collection: any): any[] =>
  Array.isArray(collection)
    ? collection
    : collection && typeof collection === "object"
      ? Object.values(collection)
      : [];

const gone = (item: any) =>
  !item || item.archived === true || Number(item.deletedAt || 0) > 0;

export function isDeckExport(json: any): boolean {
  return (
    !!json &&
    typeof json === "object" &&
    typeof json.version === "string" &&
    values(json.boards).length > 0 &&
    values(json.boards).every((board) => board && "stacks" in board)
  );
}

const byOrder = (items: any[]) =>
  items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        (Number(a.item.order) || 0) - (Number(b.item.order) || 0) ||
        a.index - b.index,
    )
    .map(({ item }) => item);

export function deckJsonToBoards(json: any): ImportBoard[] | null {
  if (!isDeckExport(json)) return null;

  return values(json.boards)
    .filter((board) => !gone(board))
    .map((board) => ({
      name: String(board.title || "").trim() || "Deck import",
      areas: byOrder(values(board.stacks).filter((stack) => !gone(stack))).map(
        (stack) => ({
          name: String(stack.title || "").trim() || "—",
          cards: byOrder(values(stack.cards).filter((card) => !gone(card))).map(
            (card) => ({
              name: String(card.title || "").trim() || "—",
              content: String(card.description || "").trim(),
              done: !!card.done,
              dueDate: typeof card.duedate === "string" ? card.duedate : null,
              labels: values(card.labels)
                .map((label) => String(label?.title || "").trim())
                .filter(Boolean),
              comments: values(card.comments)
                .filter((comment) => String(comment?.message || "").trim())
                .map((comment) => ({
                  authorName: String(
                    comment.actorDisplayName || comment.actorId || "Deck",
                  ),
                  content: String(comment.message).trim(),
                  date:
                    typeof comment.creationDateTime === "string"
                      ? comment.creationDateTime
                      : null,
                }))
                .sort(
                  (a, b) =>
                    new Date(a.date || 0).getTime() -
                    new Date(b.date || 0).getTime(),
                ),
              files: [],
            }),
          ),
        }),
      ),
    }));
}
