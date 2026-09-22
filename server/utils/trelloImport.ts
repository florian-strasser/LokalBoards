import type { ImportBoard } from "./boardImport";

// Pure helpers for the Trello board import (server/api/data/import/trello.ts).
// Kept here — free of DB/HTTP — so the parsing can be unit-tested in isolation.
// Card descriptions and comments are stored as Markdown, and Trello's own
// descriptions/comments are already Markdown, so we largely pass them through
// (only checklists and link attachments are assembled into Markdown).

// Guard rails so a pathological board can't create an unbounded amount of data.
export const MAX_LISTS = 500;
export const MAX_CARDS = 5000;
const NAME_MAX = 255;

// Pull the board shortLink (or 24-char id) out of a pasted Trello URL. Accepts
// e.g. https://trello.com/b/AbCd1234/my-board (with or without the slug, with or
// without a trailing .json). Returns null if it isn't a Trello *board* URL.
export function parseTrelloShortLink(input: string): string | null {
  if (!input || typeof input !== "string") return null;
  const match = input.match(/trello\.com\/b\/([A-Za-z0-9]{4,32})/i);
  return match ? match[1] : null;
}

// Render a Trello checklist as a Markdown task list.
export function checklistToMarkdown(
  name: string,
  items: Array<{ name: string; state: string; pos: number }>,
): string {
  const ordered = [...(items || [])].sort((a, b) => (a.pos || 0) - (b.pos || 0));
  const heading = name ? `**${String(name).trim()}**` : "";
  if (ordered.length === 0) return heading;
  const lines = ordered
    .map(
      (it) =>
        `- [${it.state === "complete" ? "x" : " "}] ${String(it.name || "").trim()}`,
    )
    .join("\n");
  return heading ? `${heading}\n\n${lines}` : lines;
}

// Trello has two kinds of attachment. **Link** attachments (isUpload false) are
// just URLs — there's no file to host, so we keep them as a Markdown link list
// appended to the card. **File** attachments (isUpload true) are real uploads;
// their download URL 302-redirects to a public S3 file for public boards, so the
// import endpoint downloads and re-hosts those as normal LokalBoards
// attachments (see ImportedAttachment below).
export function linkAttachmentsToMarkdown(attachments: any[]): string {
  const list = (attachments || []).filter(
    (a: any) => a && a.isUpload !== true && (a.url || a.name),
  );
  if (list.length === 0) return "";
  const items = list
    .sort((a: any, b: any) => (a.pos || 0) - (b.pos || 0))
    .map((a: any) => {
      const label = String(a.name || a.fileName || a.url || "attachment").trim();
      const url = typeof a.url === "string" ? a.url : "";
      return /^https?:\/\//i.test(url) ? `- [${label}](${url})` : `- ${label}`;
    })
    .join("\n");
  return `**Links**\n\n${items}`;
}

export interface ImportedComment {
  authorName: string;
  content: string;
  date: string | null;
}

// A Trello uploaded file the import endpoint should download and re-host.
export interface ImportedAttachment {
  name: string;
  url: string;
  mimeType: string;
  bytes: number | null;
}

export interface ImportedBoard {
  name: string;
  areas: Array<{
    name: string;
    cards: Array<{
      name: string;
      content: string;
      status: number;
      labels: string[];
      dueDate: string | null;
      comments: ImportedComment[];
      attachments: ImportedAttachment[];
    }>;
  }>;
}

// Transform a parsed Trello board-JSON export into the structure LokalBoards
// stores: a board name, its open lists (areas) in order, and each list's open
// cards (name + description + checklists + attachment links, as Markdown, plus
// comments). Returns null when the payload isn't a readable board export.
export function trelloJsonToBoard(trello: any): ImportedBoard | null {
  if (!trello || typeof trello !== "object" || !Array.isArray(trello.lists)) {
    return null;
  }

  const byPos = (a: any, b: any) => (a.pos || 0) - (b.pos || 0);

  const lists = (trello.lists || [])
    .filter((l: any) => l && !l.closed)
    .sort(byPos)
    .slice(0, MAX_LISTS);

  const checklistsByCard = new Map<string, any[]>();
  for (const cl of trello.checklists || []) {
    if (!cl || !cl.idCard) continue;
    if (!checklistsByCard.has(cl.idCard)) checklistsByCard.set(cl.idCard, []);
    checklistsByCard.get(cl.idCard)!.push(cl);
  }

  // The authoritative member display name lives in the board's member list;
  // the memberCreator snapshot embedded in each action can lack a full name
  // (then it would fall back to the @username), so prefer members[] by id.
  const membersById = new Map<string, { fullName: string; username: string }>();
  for (const m of trello.members || []) {
    if (m && m.id) {
      membersById.set(m.id, {
        fullName: typeof m.fullName === "string" ? m.fullName : "",
        username: typeof m.username === "string" ? m.username : "",
      });
    }
  }

  // Comments live in the board's action feed (capped at ~1000 by Trello's
  // export), keyed by the card they belong to. The Trello author's name is kept
  // for display; the comment isn't linked to any local user account. The text is
  // already Markdown, so it's stored as-is.
  const commentsByCard = new Map<string, ImportedComment[]>();
  for (const action of trello.actions || []) {
    if (!action || action.type !== "commentCard") continue;
    const cardId = action.data?.card?.id;
    const text = action.data?.text;
    if (!cardId || !text) continue;
    const creatorId = action.idMemberCreator || action.memberCreator?.id;
    const member = creatorId ? membersById.get(creatorId) : undefined;
    const author =
      member?.fullName ||
      action.memberCreator?.fullName ||
      member?.username ||
      action.memberCreator?.username ||
      "Trello";
    if (!commentsByCard.has(cardId)) commentsByCard.set(cardId, []);
    commentsByCard.get(cardId)!.push({
      authorName: String(author).slice(0, NAME_MAX),
      content: String(text).trim(),
      date: typeof action.date === "string" ? action.date : null,
    });
  }

  const cardsByList = new Map<string, any[]>();
  let cardBudget = MAX_CARDS;
  const openCards = (trello.cards || [])
    .filter((c: any) => c && !c.closed)
    .sort(byPos);
  for (const card of openCards) {
    if (cardBudget <= 0) break;
    if (!cardsByList.has(card.idList)) cardsByList.set(card.idList, []);
    cardsByList.get(card.idList)!.push(card);
    cardBudget--;
  }

  const name =
    (typeof trello.name === "string" && trello.name.trim()) || "Trello import";

  const areas = lists.map((list: any) => {
    const cards = (cardsByList.get(list.id) || []).map((card: any) => {
      // Assemble the card body as Markdown: description, then each checklist,
      // then link attachments — separated by blank lines.
      const parts: string[] = [];
      const desc = String(card.desc || "").trim();
      if (desc) parts.push(desc);
      const checklists = (checklistsByCard.get(card.id) || []).sort(byPos);
      for (const cl of checklists) {
        const block = checklistToMarkdown(cl.name || "", cl.checkItems || []);
        if (block) parts.push(block);
      }
      const rawAttachments = card.attachments || [];
      const links = linkAttachmentsToMarkdown(rawAttachments);
      if (links) parts.push(links);
      const content = parts.join("\n\n");

      // Uploaded files are downloaded and re-hosted by the endpoint.
      const attachments: ImportedAttachment[] = rawAttachments
        .filter(
          (a: any) =>
            a &&
            a.isUpload === true &&
            typeof a.url === "string" &&
            /^https?:\/\//i.test(a.url),
        )
        .sort((a: any, b: any) => (a.pos || 0) - (b.pos || 0))
        .map((a: any) => ({
          name: String(a.name || a.fileName || "attachment").slice(0, NAME_MAX),
          url: a.url,
          mimeType: typeof a.mimeType === "string" ? a.mimeType : "",
          bytes: typeof a.bytes === "number" ? a.bytes : null,
        }));

      const comments = (commentsByCard.get(card.id) || [])
        .slice()
        .sort(
          (a, b) =>
            new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime(),
        );

      // A card counts as done if Trello's completion flag is set (the "mark
      // complete" checkmark / a completed due date).
      const status =
        card.dueComplete === true || !!card.dateCompleted ? 1 : 0;

      return {
        name: String(card.name || "").slice(0, NAME_MAX) || "—",
        content,
        status,
        // A Trello label without a name is a colour, and the colour is the
        // word Trello shows for it.
        labels: (card.labels || [])
          .map((label: any) =>
            String(label?.name || "").trim() || String(label?.color || ""),
          )
          .filter(Boolean),
        dueDate: typeof card.due === "string" ? card.due : null,
        comments,
        attachments,
      };
    });
    return { name: String(list.name || "").slice(0, NAME_MAX), cards };
  });

  return { name: name.slice(0, NAME_MAX), areas };
}

// ---------------------------------------------------------------------------
// The same board, from a file.
//
// Trello's own export — the board menu's Print, export and share → Export as
// JSON — is the very JSON a public board serves at `trello.com/b/<id>.json`,
// which is what the link import reads. So a file needs no parser of its own,
// only recognising: it is a board with a `shortLink`, its lists, cards and
// action feed, and none of the markers the Wekan and Deck exports carry.
export function isTrelloExport(json: any): boolean {
  return (
    !!json &&
    typeof json === "object" &&
    typeof json.shortLink === "string" &&
    Array.isArray(json.lists) &&
    Array.isArray(json.cards) &&
    Array.isArray(json.actions) &&
    json._format === undefined
  );
}

/** A Trello board in the shape `boardImport.ts` writes; its uploaded files are
 *  links to Trello, fetched while the board is written. */
export function trelloToImport(trello: any): ImportBoard | null {
  const board = trelloJsonToBoard(trello);
  if (!board) return null;
  return {
    name: board.name,
    areas: board.areas.map((area) => ({
      name: area.name,
      cards: area.cards.map((card) => ({
        name: card.name,
        content: card.content,
        done: card.status === 1,
        dueDate: card.dueDate,
        labels: card.labels,
        comments: card.comments,
        files: card.attachments.map((file) => ({
          name: file.name,
          type: file.mimeType,
          url: file.url,
          bytes: file.bytes,
        })),
      })),
    })),
  };
}
