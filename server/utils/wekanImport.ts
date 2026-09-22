import type { ImportBoard, ImportCard } from "./boardImport";
import { checklistToMarkdown } from "./trelloImport";

// Reading a Wekan board export — the JSON from a board's menu, Export board —
// into the shape `boardImport.ts` writes.
//
// The file is recognised by its `_format`, `wekan-board-1.0.0` in the Wekan of
// September 2026 (the export the tests are written against, in
// `test/fixtures/import/`). Wekan's descriptions and comments are Markdown
// already. Its checklists become a Markdown checklist under the description,
// as a Trello card's do. A card is done when its due date is marked complete.
// Labels come across as their names; a label that is only a colour becomes the
// colour's name, which is the word Wekan shows for it too. Files are in the
// export itself, as base64.
//
// Swimlanes are rows across the lists; a board here has none, so every card
// goes to its list whichever row it was in. Archived lists and cards stay
// behind. People are not carried over: comments keep their author's name.

export function isWekanExport(json: any): boolean {
  return (
    !!json &&
    typeof json === "object" &&
    typeof json._format === "string" &&
    json._format.startsWith("wekan-board") &&
    Array.isArray(json.lists) &&
    Array.isArray(json.cards)
  );
}

// Wekan sorts by `sort`; a list or card that never got one keeps the order it
// has in the file, which is the order it was created in.
const bySort = <T extends { sort?: number | null }>(items: T[]): T[] =>
  items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        (a.item.sort ?? Number.MAX_SAFE_INTEGER) -
          (b.item.sort ?? Number.MAX_SAFE_INTEGER) || a.index - b.index,
    )
    .map(({ item }) => item);

export function wekanJsonToBoard(json: any): ImportBoard | null {
  if (!isWekanExport(json)) return null;

  const names = new Map<string, string>();
  for (const user of json.users || []) {
    if (!user?._id) continue;
    names.set(
      user._id,
      String(user.profile?.fullname || user.username || "Wekan").trim(),
    );
  }

  const labelNames = new Map<string, string>();
  for (const label of json.labels || []) {
    if (!label?._id) continue;
    const name = String(label.name || "").trim() || String(label.color || "");
    if (name) labelNames.set(label._id, name);
  }

  const itemsByChecklist = new Map<string, any[]>();
  for (const item of json.checklistItems || []) {
    if (!item?.checklistId) continue;
    const list = itemsByChecklist.get(item.checklistId) ?? [];
    list.push(item);
    itemsByChecklist.set(item.checklistId, list);
  }
  const checklistsByCard = new Map<string, any[]>();
  for (const checklist of json.checklists || []) {
    if (!checklist?.cardId) continue;
    const list = checklistsByCard.get(checklist.cardId) ?? [];
    list.push(checklist);
    checklistsByCard.set(checklist.cardId, list);
  }

  const commentsByCard = new Map<string, any[]>();
  for (const comment of json.comments || []) {
    if (!comment?.cardId || !String(comment.text || "").trim()) continue;
    const list = commentsByCard.get(comment.cardId) ?? [];
    list.push(comment);
    commentsByCard.set(comment.cardId, list);
  }

  const filesByCard = new Map<string, any[]>();
  for (const file of json.attachments || []) {
    if (!file?.cardId || typeof file.file !== "string") continue;
    const list = filesByCard.get(file.cardId) ?? [];
    list.push(file);
    filesByCard.set(file.cardId, list);
  }

  const cardsByList = new Map<string, any[]>();
  for (const card of json.cards) {
    if (!card || card.archived || !card.listId) continue;
    const list = cardsByList.get(card.listId) ?? [];
    list.push(card);
    cardsByList.set(card.listId, list);
  }

  const toCard = (card: any): ImportCard => {
    const parts: string[] = [];
    const description = String(card.description || "").trim();
    if (description) parts.push(description);
    for (const checklist of bySort(checklistsByCard.get(card._id) ?? [])) {
      const items = bySort(itemsByChecklist.get(checklist._id) ?? []).map(
        (item: any, index: number) => ({
          name: String(item.title || ""),
          state: item.isFinished ? "complete" : "incomplete",
          pos: index,
        }),
      );
      const block = checklistToMarkdown(String(checklist.title || ""), items);
      if (block) parts.push(block);
    }

    const comments = (commentsByCard.get(card._id) ?? [])
      .map((comment: any) => ({
        authorName: names.get(comment.userId) || "Wekan",
        content: String(comment.text || "").trim(),
        date: typeof comment.createdAt === "string" ? comment.createdAt : null,
      }))
      .sort(
        (a, b) =>
          new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime(),
      );

    return {
      name: String(card.title || "").trim() || "—",
      content: parts.join("\n\n"),
      done: card.dueComplete === true,
      dueDate: typeof card.dueAt === "string" ? card.dueAt : null,
      labels: (card.labelIds || [])
        .map((id: string) => labelNames.get(id))
        .filter(Boolean),
      comments,
      files: (filesByCard.get(card._id) ?? []).map((file: any) => ({
        name: String(file.name || "attachment"),
        type: String(file.type || "application/octet-stream"),
        data: file.file,
      })),
    };
  };

  const areas = bySort((json.lists as any[]).filter((l) => l && !l.archived)).map(
    (list: any) => ({
      name: String(list.title || "").trim() || "—",
      cards: bySort(cardsByList.get(list._id) ?? []).map(toCard),
    }),
  );

  return {
    name: String(json.title || "").trim() || "Wekan import",
    areas,
  };
}
