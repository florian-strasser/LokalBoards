// A board, written down in full.
//
// One JSON file per board holding everything somebody looking at the board could
// see — its areas, every card with its description, labels, reminders, comments,
// attachments and history — plus the files those name, laid out beside it in
// the zip. The board's own ⋮ › Export board and an administrator's export of the
// whole instance both use this, so a board file reads the same from either.
//
// Archived areas and cards are included and say so with `archivedAt`. An export
// is what somebody keeps, and a card thrown away last week is still work that
// happened.

import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import archiver from "archiver";

export const EXPORT_FORMAT = "lokalboards.board";
export const EXPORT_FORMAT_VERSION = 1;

const STORED_FILE = /^\/(?:api\/)?uploads\/([A-Za-z0-9._-]+)$/;
const REFERENCE = /\/(?:api\/)?uploads\/([A-Za-z0-9._-]+)/g;

// Something to put in the zip: a file already on disk, or bytes held in the
// database by an attachment from before uploads were written to disk.
export interface ExportEntry {
  name: string;
  source?: string;
  data?: Buffer;
}

export function slugify(text: string, fallback = "board"): string {
  const slug = String(text || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return slug || fallback;
}

// The id keeps two boards called "Website" apart; the name is there for the
// person opening the zip.
export const boardFolder = (board: { id: number; name: string }) =>
  `${board.id}-${slugify(board.name)}`;

// An attachment's own name, made safe to be one path segment: no separators, no
// control characters, and no leading dots to climb out of its folder with.
export function safeFileName(name: string): string {
  const cleaned = String(name || "")
    .replace(/[\x00-\x1f\x7f/\\]/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 150);
  return cleaned || "file";
}

export const exportDate = (now = new Date()) => now.toISOString().slice(0, 10);

// The quoted form is plain ASCII for old clients; `filename*` carries the real
// name, which is what every current browser uses.
export function downloadDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function createZip() {
  return archiver("zip", { zlib: { level: 6 } });
}

export function addEntries(archive: any, entries: ExportEntry[]) {
  for (const entry of entries) {
    if (entry.source) archive.file(entry.source, { name: entry.name });
    else if (entry.data) archive.append(entry.data, { name: entry.name });
  }
}

const parseData = (text: unknown) => {
  if (text === null || text === undefined) return null;
  try {
    return JSON.parse(String(text));
  } catch {
    return text;
  }
};

/**
 * The JSON for one board, and the files that belong next to it.
 *
 * `filesAt` is where this board's files go inside the zip, ending in a slash —
 * `attachments/` when the zip holds one board, `attachments/<board>/` when it
 * holds them all. Every path written into the JSON is relative to the zip's
 * root, so it can be followed as it stands.
 *
 * Returns null when there is no such board.
 */
export async function buildBoardExport(
  db: any,
  boardId: number,
  options: { filesAt: string; version?: string | null; now?: Date },
): Promise<{ json: any; entries: ExportEntry[] } | null> {
  const { filesAt, version = null, now = new Date() } = options;

  const [boards]: any = await db.execute(
    "SELECT * FROM `boards` WHERE `id` = ?",
    [boardId],
  );
  const board = boards[0];
  if (!board) return null;

  // Every card on the board, archived or not, as a subquery rather than a list
  // of ids: a board with a few thousand cards should not become a statement
  // with a few thousand placeholders.
  const ON_BOARD =
    "SELECT c.`id` FROM `cards` c JOIN `areas` a ON a.`id` = c.`area` WHERE a.`board` = ?";

  const [areas]: any = await db.execute(
    "SELECT `id`, `name`, `sort`, `archivedAt` FROM `areas` WHERE `board` = ? ORDER BY `sort`, `id`",
    [boardId],
  );
  const [cards]: any = await db.execute(
    "SELECT c.`id`, c.`area`, c.`name`, c.`content`, c.`status`, c.`sort`, c.`dueDate`, c.`repeatEvery`, c.`archivedAt` FROM `cards` c JOIN `areas` a ON a.`id` = c.`area` WHERE a.`board` = ? ORDER BY c.`sort`, c.`id`",
    [boardId],
  );
  const [labels]: any = await db.execute(
    "SELECT `id`, `name` FROM `labels` WHERE `board` = ? ORDER BY `sort`, `id`",
    [boardId],
  );
  const [worn]: any = await db.execute(
    "SELECT cl.`card`, l.`name` FROM `card_labels` cl JOIN `labels` l ON l.`id` = cl.`label` WHERE l.`board` = ? ORDER BY l.`sort`, l.`id`",
    [boardId],
  );
  const [comments]: any = await db.execute(
    `SELECT \`id\`, \`card\`, \`user\`, \`authorName\`, \`content\`, \`date\` FROM \`comments\` WHERE \`card\` IN (${ON_BOARD}) ORDER BY \`date\`, \`id\``,
    [boardId],
  );
  const [attachments]: any = await db.execute(
    `SELECT \`id\`, \`card\`, \`filename\`, \`filetype\`, \`filesize\`, \`filedata\`, \`createdAt\` FROM \`attachments\` WHERE \`card\` IN (${ON_BOARD}) ORDER BY \`id\``,
    [boardId],
  );
  const [reminders]: any = await db.execute(
    `SELECT \`card\`, \`minutesBefore\` FROM \`card_reminders\` WHERE \`card\` IN (${ON_BOARD}) ORDER BY \`minutesBefore\``,
    [boardId],
  );
  const [activity]: any = await db.execute(
    `SELECT \`card\`, \`actorId\`, \`type\`, \`data\`, \`createdAt\` FROM \`card_activity\` WHERE \`card\` IN (${ON_BOARD}) ORDER BY \`createdAt\`, \`id\``,
    [boardId],
  );
  const [invitations]: any = await db.execute(
    "SELECT `user`, `permission` FROM `invitations` WHERE `board` = ? ORDER BY `id`",
    [boardId],
  );
  const [onCards]: any = await db.execute(
    `SELECT \`card\`, \`user\` FROM \`card_assignees\` WHERE \`card\` IN (${ON_BOARD}) ORDER BY \`id\``,
    [boardId],
  );
  const assigneesByCard = new Map<number, string[]>();
  for (const row of onCards) {
    const list = assigneesByCard.get(Number(row.card)) ?? [];
    list.push(String(row.user));
    assigneesByCard.set(Number(row.card), list);
  }

  // People by name rather than by id alone, so the file still says who did
  // what when it is read somewhere the accounts do not exist. No addresses: a
  // board's members can see each other's names, and that is all this repeats.
  const ids = new Set<string>();
  for (const id of [
    board.user,
    ...invitations.map((row: any) => row.user),
    ...onCards.map((row: any) => row.user),
    ...comments.map((row: any) => row.user),
    ...activity.map((row: any) => row.actorId),
  ]) {
    if (id) ids.add(String(id));
  }
  const names = new Map<string, string>();
  if (ids.size) {
    const [rows]: any = await db.query(
      "SELECT `id`, `name` FROM `user` WHERE `id` IN (?)",
      [[...ids]],
    );
    for (const row of rows) names.set(String(row.id), row.name);
  }
  const person = (id: unknown, fallbackName: string | null = null) =>
    id
      ? { id: String(id), name: names.get(String(id)) ?? fallbackName }
      : fallbackName
        ? { id: null, name: fallbackName }
        : null;

  const uploadDir = resolve(join(process.cwd(), "public", "uploads"));
  const onDisk = async (storedName: string) => {
    const path = resolve(uploadDir, storedName);
    if (!path.startsWith(uploadDir)) return null;
    try {
      return (await stat(path)).isFile() ? path : null;
    } catch {
      return null;
    }
  };

  const entries: ExportEntry[] = [];
  const written = new Set<string>();
  const add = (entry: ExportEntry) => {
    if (written.has(entry.name)) return;
    written.add(entry.name);
    entries.push(entry);
  };

  // Pictures pasted into a description or a comment are uploads too, named in
  // the HTML by their address. `images` maps each address to its copy in the
  // zip, so the description can be read with its pictures in place.
  const images: Record<string, string> = {};
  const collectImages = async (text: unknown) => {
    for (const match of String(text || "").matchAll(REFERENCE)) {
      if (images[match[0]]) continue;
      const source = await onDisk(match[1]);
      if (!source) continue;
      const name = `${filesAt}images/${match[1]}`;
      images[match[0]] = name;
      add({ name, source });
    }
  };

  const attachmentFile = async (row: any) => {
    const data = String(row.filedata || "");
    const name = `${filesAt}${row.id}-${safeFileName(row.filename)}`;
    const stored = data.match(STORED_FILE);
    if (stored) {
      const source = await onDisk(stored[1]);
      if (!source) return { file: null };
      add({ name, source });
      return { file: name };
    }
    // Linked rather than uploaded: there is nothing to copy, only somewhere
    // to point.
    if (/^https?:\/\//i.test(data)) return { file: null, url: data };
    if (!data) return { file: null };
    // Attachments from before uploads went to disk hold their bytes in the row.
    add({
      name,
      data: Buffer.from(data.replace(/^data:[^,]*;base64,/, ""), "base64"),
    });
    return { file: name };
  };

  await collectImages(board.image);

  const byCard = <T>(rows: any[], map: (row: any) => T) => {
    const grouped = new Map<number, T[]>();
    for (const row of rows) {
      const list = grouped.get(row.card) ?? [];
      list.push(map(row));
      grouped.set(row.card, list);
    }
    return grouped;
  };

  const labelsByCard = byCard(worn, (row) => row.name as string);
  const remindersByCard = byCard(reminders, (row) => Number(row.minutesBefore));
  const activityByCard = byCard(activity, (row) => ({
    type: row.type,
    actor: person(row.actorId),
    data: parseData(row.data),
    createdAt: row.createdAt,
  }));

  const commentsByCard = new Map<number, any[]>();
  for (const row of comments) {
    await collectImages(row.content);
    const list = commentsByCard.get(row.card) ?? [];
    list.push({
      id: row.id,
      author: person(row.user, row.authorName ?? null),
      content: row.content ?? "",
      createdAt: row.date,
    });
    commentsByCard.set(row.card, list);
  }

  const attachmentsByCard = new Map<number, any[]>();
  for (const row of attachments) {
    const list = attachmentsByCard.get(row.card) ?? [];
    list.push({
      id: row.id,
      filename: row.filename,
      filetype: row.filetype,
      filesize: row.filesize,
      createdAt: row.createdAt,
      ...(await attachmentFile(row)),
    });
    attachmentsByCard.set(row.card, list);
  }

  const cardsByArea = new Map<number, any[]>();
  for (const card of cards) {
    await collectImages(card.content);
    const list = cardsByArea.get(card.area) ?? [];
    list.push({
      id: card.id,
      name: card.name,
      content: card.content ?? "",
      done: !!card.status,
      sort: card.sort,
      dueDate: card.dueDate ?? null,
      repeat: card.repeatEvery ?? null,
      // Everyone on it, in the order they were added. `assignee` is the first
      // of them, as the API reports it for older integrations.
      assignees: (assigneesByCard.get(Number(card.id)) ?? []).map((id) =>
        person(id),
      ),
      assignee: person(assigneesByCard.get(Number(card.id))?.[0] ?? null),
      labels: labelsByCard.get(card.id) ?? [],
      archivedAt: card.archivedAt ?? null,
      reminders: remindersByCard.get(card.id) ?? [],
      attachments: attachmentsByCard.get(card.id) ?? [],
      comments: commentsByCard.get(card.id) ?? [],
      activity: activityByCard.get(card.id) ?? [],
    });
    cardsByArea.set(card.area, list);
  }

  const json = {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    lokalboardsVersion: version,
    exportedAt: now.toISOString(),
    board: {
      id: board.id,
      name: board.name,
      style: board.style,
      status: board.status,
      color: board.color ?? null,
      image: board.image ?? null,
      owner: person(board.user),
      archivedAt: board.archivedAt ?? null,
    },
    members: invitations
      .filter((row: any) => row.user)
      .map((row: any) => ({ ...person(row.user), permission: row.permission })),
    labels: labels.map((row: any) => ({ id: row.id, name: row.name })),
    areas: areas.map((area: any) => ({
      id: area.id,
      name: area.name,
      sort: area.sort,
      archivedAt: area.archivedAt ?? null,
      cards: cardsByArea.get(area.id) ?? [],
    })),
    images,
  };

  return { json, entries };
}
