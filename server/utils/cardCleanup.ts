// Everything that hangs off a card, removed with it.
//
// Deleting a card used to take its comments and its notifications and leave the
// rest: the attachment rows stayed, their uploaded files stayed on disk for
// ever, and the reminders and the activity trail stayed with them. Deleting an
// area or a whole board left the same debris for every card in it. Nothing
// visible pointed at any of it, which is exactly why it went unnoticed — and
// why the files grew without bound.
//
// Card duplication made it worse: a duplicate's attachments are copies on disk,
// so every deleted duplicate leaked its own files.

import { pruneUnusedLabels } from "./labelCleanup";

const STORED_FILE = /^\/(?:api\/)?uploads\/([A-Za-z0-9._-]+)$/;

export async function removeCardData(
  db: any,
  cardIds: number[],
): Promise<{ attachments: number; files: number }> {
  const ids = cardIds.map(Number).filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) return { attachments: 0, files: 0 };

  const placeholders = ids.map(() => "?").join(",");

  // The files first, while the rows that name them still exist.
  const [attachments]: any = await db.execute(
    `SELECT id, filedata FROM attachments WHERE card IN (${placeholders})`,
    ids,
  );

  await db.execute(
    `DELETE FROM attachments WHERE card IN (${placeholders})`,
    ids,
  );
  await db.execute(`DELETE FROM comments WHERE card IN (${placeholders})`, ids);
  await db.execute(
    `DELETE FROM card_reminders WHERE card IN (${placeholders})`,
    ids,
  );
  // What these cards wore, read while the assignments still exist. A label is
  // kept alive by the cards using it, so the last card to carry a name takes
  // that name with it.
  const [worn]: any = await db.execute(
    `SELECT DISTINCT label FROM card_labels WHERE card IN (${placeholders})`,
    ids,
  );
  await db.execute(
    `DELETE FROM card_labels WHERE card IN (${placeholders})`,
    ids,
  );
  await db.execute(
    `DELETE FROM card_activity WHERE card IN (${placeholders})`,
    ids,
  );
  await db.execute(
    `DELETE FROM notifications WHERE cardId IN (${placeholders})`,
    ids,
  );

  await pruneUnusedLabels(
    db,
    (worn as any[]).map((row) => Number(row.label)),
  );

  const files = await unlinkOrphanedFiles(db, attachments);
  return { attachments: attachments.length, files };
}

// Removes the uploaded files those attachments named, once nothing else names
// them.
//
// The check is not paranoia: before duplication copied files, nothing stopped
// two rows pointing at one path, and an instance that has been running a while
// may have such a pair. Unlinking a file another attachment still refers to
// would turn a tidy-up into a broken download.
export async function unlinkOrphanedFiles(
  db: any,
  attachments: Array<{ filedata?: string }>,
): Promise<number> {
  const names = new Set<string>();
  for (const row of attachments) {
    const match = String(row?.filedata || "").match(STORED_FILE);
    if (match) names.add(match[1]);
  }
  if (!names.size) return 0;

  const { unlink } = await import("node:fs/promises");
  const { join, resolve } = await import("node:path");
  const uploadDir = resolve(join(process.cwd(), "public", "uploads"));
  let removed = 0;

  for (const name of names) {
    try {
      const [stillUsed]: any = await db.execute(
        "SELECT 1 FROM attachments WHERE filedata LIKE ? LIMIT 1",
        [`%/uploads/${name}`],
      );
      if (stillUsed.length) continue;

      const path = resolve(uploadDir, name);
      // The pattern excludes separators already; resolve and check anyway, the
      // same guard /api/uploads applies.
      if (!path.startsWith(uploadDir)) continue;
      await unlink(path);
      removed += 1;
    } catch {
      // Already gone, or never written. Either way there is nothing to remove.
    }
  }
  return removed;
}

// The cards in an area, or in a whole board — so a deletion higher up can clear
// everything beneath it.
export async function cardIdsInAreas(
  db: any,
  areaIds: number[],
): Promise<number[]> {
  const ids = areaIds.map(Number).filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) return [];
  const [rows]: any = await db.execute(
    `SELECT id FROM cards WHERE area IN (${ids.map(() => "?").join(",")})`,
    ids,
  );
  return rows.map((row: any) => Number(row.id));
}

export async function cardIdsInBoard(
  db: any,
  boardId: number | string,
): Promise<number[]> {
  const [rows]: any = await db.execute(
    "SELECT c.id FROM cards c JOIN areas a ON c.area = a.id WHERE a.board = ?",
    [boardId],
  );
  return rows.map((row: any) => Number(row.id));
}
