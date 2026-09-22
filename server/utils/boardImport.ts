import { serverText } from "./serverText";

// A board brought over from another tool, and the one place that writes it.
//
// Each importer (see `wekanImport.ts`, `deckImport.ts`) only reads its tool's
// export into this shape; what a LokalBoards board is made of — which tables,
// which limits, what a label may be called — is decided here, once. The shape
// holds what every one of those tools has in common: columns of cards, each
// with a Markdown description, a done state, a due date, labels as words,
// comments by name, and files.
//
// Nobody on the other tool is a user here, so people are not carried over:
// comments keep their author's name as text. Archived columns and cards are
// left behind. A file that cannot be brought over — a link the server may not
// fetch, one too large, one past the count — is not dropped without a word:
// the card lists it as a link under its description, so it can still be
// fetched by hand while the old tool is there.

export interface ImportComment {
  authorName: string;
  content: string;
  date: string | null;
}

// A file comes either with its bytes, as Wekan's export carries them, or as a
// link to where it is, when the importer could not fetch it (see
// `trelloFiles.ts`) — then the card lists it as a link.
export interface ImportFile {
  name: string;
  type: string;
  // The file's bytes, base64-encoded.
  data?: string;
  url?: string;
  bytes?: number | null;
}

export interface ImportOptions {
  // The instance's language, for the one heading the import writes itself.
  language?: string;
}

export interface ImportCard {
  name: string;
  content: string;
  done: boolean;
  dueDate: string | null;
  labels: string[];
  comments: ImportComment[];
  files: ImportFile[];
}

export interface ImportBoard {
  name: string;
  areas: Array<{ name: string; cards: ImportCard[] }>;
}

// The limits a board here has anyway, and a guard against a pathological file.
export const MAX_AREAS = 500;
export const MAX_CARDS = 5000;
const MAX_LABELS = 30;
const LABEL_MAX = 64;
const NAME_MAX = 255;
// Per file, comfortably under MySQL's default max_allowed_packet once stored as
// base64 — the same cap the Trello import uses — and a count for the board.
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 300;

const LABEL_COLOR = "#0066cc";

/** The labels a board ends up with: each word once, whatever its case, and no
 *  more than a board may hold. */
export function boardLabelNames(board: ImportBoard): string[] {
  const seen = new Map<string, string>();
  for (const area of board.areas) {
    for (const card of area.cards) {
      for (const raw of card.labels) {
        const name = String(raw || "").trim().slice(0, LABEL_MAX);
        if (name && !seen.has(name.toLowerCase())) {
          seen.set(name.toLowerCase(), name);
        }
      }
    }
  }
  return [...seen.values()].slice(0, MAX_LABELS);
}

/**
 * Writes the board for `userId`, private, and answers with its id. The board,
 * its columns, cards, labels and comments go in one transaction; the files
 * follow once that has committed, one by one, so a file that will not go in
 * costs that file and not the board.
 */
export async function writeImportedBoard(
  db: any,
  userId: string,
  board: ImportBoard,
  options: ImportOptions = {},
): Promise<{ boardId: number; files: number; linked: number }> {
  const conn = await db.getConnection();
  const pendingFiles: Array<{ cardId: number; file: ImportFile }> = [];
  let boardId = 0;
  try {
    await conn.beginTransaction();
    const [created]: any = await conn.execute(
      "INSERT INTO boards (user, name, style, image, status) VALUES (?, ?, 'kanban', NULL, 'private')",
      [userId, String(board.name || "Import").slice(0, NAME_MAX)],
    );
    boardId = Number(created.insertId);

    const labelIds = new Map<string, number>();
    let labelSort = 0;
    for (const name of boardLabelNames(board)) {
      const [row]: any = await conn.execute(
        "INSERT INTO `labels` (`board`, `name`, `color`, `sort`) VALUES (?, ?, ?, ?)",
        [boardId, name, LABEL_COLOR, labelSort++],
      );
      labelIds.set(name.toLowerCase(), Number(row.insertId));
    }

    let areaSort = 0;
    let cardBudget = MAX_CARDS;
    for (const area of board.areas.slice(0, MAX_AREAS)) {
      const [createdArea]: any = await conn.execute(
        "INSERT INTO areas (board, name, sort) VALUES (?, ?, ?)",
        [boardId, String(area.name || "—").slice(0, NAME_MAX), areaSort++],
      );
      const areaId = Number(createdArea.insertId);

      let cardSort = 0;
      for (const card of area.cards) {
        if (cardBudget-- <= 0) break;
        const due = card.dueDate ? new Date(card.dueDate) : null;
        const [createdCard]: any = await conn.execute(
          "INSERT INTO cards (area, name, content, status, sort, dueDate) VALUES (?, ?, ?, ?, ?, ?)",
          [
            areaId,
            String(card.name || "—").slice(0, NAME_MAX),
            card.content || "",
            card.done ? 1 : 0,
            cardSort++,
            due && !Number.isNaN(due.getTime()) ? due : null,
          ],
        );
        const cardId = Number(createdCard.insertId);

        const worn = new Set<number>();
        for (const label of card.labels) {
          const id = labelIds.get(
            String(label || "").trim().slice(0, LABEL_MAX).toLowerCase(),
          );
          if (id && !worn.has(id)) {
            worn.add(id);
            await conn.execute(
              "INSERT INTO `card_labels` (`card`, `label`) VALUES (?, ?)",
              [cardId, id],
            );
          }
        }

        for (const comment of card.comments) {
          const date = comment.date ? new Date(comment.date) : null;
          await conn.execute(
            "INSERT INTO comments (card, user, authorName, content, date) VALUES (?, NULL, ?, ?, ?)",
            [
              cardId,
              String(comment.authorName || "—").slice(0, NAME_MAX),
              comment.content || "",
              date && !Number.isNaN(date.getTime()) ? date : new Date(),
            ],
          );
        }

        for (const file of card.files) pendingFiles.push({ cardId, file });
      }
    }
    await conn.commit();
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }

  let files = 0;
  const leftBehind = new Map<number, ImportFile[]>();
  const leaveBehind = (cardId: number, file: ImportFile) => {
    if (!file.url) return;
    const list = leftBehind.get(cardId) ?? [];
    list.push(file);
    leftBehind.set(cardId, list);
  };

  for (const [index, { cardId, file }] of pendingFiles.entries()) {
    let bytes: Buffer | null = null;
    const type = file.type;
    if (index < MAX_FILES && file.data) {
      bytes = Buffer.from(file.data, "base64");
    }
    if (!bytes || !bytes.length || bytes.length > MAX_FILE_BYTES) {
      leaveBehind(cardId, file);
      continue;
    }
    try {
      await db.execute(
        "INSERT INTO attachments (card, filename, filetype, filesize, filedata) VALUES (?, ?, ?, ?, ?)",
        [
          cardId,
          String(file.name || "attachment").slice(0, NAME_MAX),
          String(type || "application/octet-stream").slice(0, 100),
          bytes.length,
          bytes.toString("base64"),
        ],
      );
      files++;
    } catch (error) {
      logger.error("Imported attachment could not be stored:", error);
      leaveBehind(cardId, file);
    }
  }

  const heading = serverText(options.language || "en")("importFilesNotCopied");
  let linked = 0;
  for (const [cardId, list] of leftBehind) {
    const block = filesAsLinks(heading, list);
    await db.execute(
      "UPDATE cards SET content = IF(COALESCE(content, '') = '', ?, CONCAT(content, '\n\n', ?)) WHERE id = ?",
      [block, block, cardId],
    );
    linked += list.length;
  }

  return { boardId, files, linked };
}

/** Files that stayed behind, as a Markdown list of links under a heading. */
export function filesAsLinks(heading: string, files: ImportFile[]): string {
  const safeName = (name: string) =>
    String(name || "attachment").replace(/([\\[\]])/g, "\\$1");
  const safeUrl = (url: string) =>
    String(url).replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/ /g, "%20");
  const lines = files
    .filter((file) => file.url)
    .map((file) => `- [${safeName(file.name)}](${safeUrl(file.url!)})`);
  return lines.length ? `**${heading}**\n\n${lines.join("\n")}` : "";
}
