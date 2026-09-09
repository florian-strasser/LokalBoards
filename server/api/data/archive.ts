import { defineEventHandler, getQuery, readBody } from "h3";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { notifyDashboards } from "../../utils/dashboardNotify";

// What has been put away, and how to get it back.
//
// Deleting a card, an area or a board archives it: the row stays, everything
// hanging off it stays, and `archivedAt` records when it left. Every list the
// app draws asks for `archivedAt IS NULL`, so archived work is simply not
// there — until somebody comes looking here.
//
// Restoring lives in this one endpoint rather than in three, because it is one
// idea and the caller should not have to know which table a thing is in.
// Permanent removal is not here: that is the existing DELETE on each of those
// endpoints, asked for with `permanent`, so the code that knows how to take a
// card's uploaded files with it stays in one place.

const boardOf = async (db: any, boardId: unknown) => {
  const id = Number(boardId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const [rows]: any = await db.execute("SELECT * FROM boards WHERE id = ?", [
    id,
  ]);
  return rows[0] ?? null;
};

export default defineEventHandler(async (event) => {
  const method = event.req.method;

  const auth = await resolveUserId(event);
  if (!auth.ok) {
    event.res.statusCode = auth.status;
    return { error: auth.error };
  }
  const userId = auth.userId;
  const db = setupDatabase();

  try {
    if (method === "GET") {
      const query = getQuery(event);

      // Without a board: the boards this account has archived. Only the owner
      // archives a board, so only the owner has one to find.
      if (!query.boardId) {
        const [boards]: any = await db.execute(
          "SELECT `id`, `name`, `archivedAt` FROM `boards` WHERE `user` = ? AND `archivedAt` IS NOT NULL ORDER BY `archivedAt` DESC",
          [userId],
        );
        return { boards };
      }

      const board = await boardOf(db, query.boardId);
      if (!board) {
        event.res.statusCode = 404;
        return { error: "Resource not found" };
      }
      // Reading the archive is the first half of restoring from it, so it takes
      // the same access as putting something in it did.
      const decision = await authorizeBoard(db, board, userId, "edit");
      if (!decision.ok) {
        event.res.statusCode = decision.status;
        return { error: decision.error };
      }

      const [areas]: any = await db.execute(
        `SELECT a.\`id\`, a.\`name\`, a.\`archivedAt\`,
                (SELECT COUNT(*) FROM \`cards\` c WHERE c.area = a.id AND c.archivedAt IS NULL) AS cardCount
           FROM \`areas\` a
          WHERE a.board = ? AND a.archivedAt IS NOT NULL
          ORDER BY a.archivedAt DESC`,
        [board.id],
      );

      // Only cards archived in their own right. One that went away inside an
      // area is not a separate thing to restore — the area is, and it brings
      // its cards back with it.
      const [cards]: any = await db.execute(
        `SELECT c.\`id\`, c.\`name\`, c.\`archivedAt\`, ar.\`name\` AS areaName
           FROM \`cards\` c
           JOIN \`areas\` ar ON ar.id = c.area
          WHERE ar.board = ? AND c.archivedAt IS NOT NULL AND ar.archivedAt IS NULL
          ORDER BY c.archivedAt DESC`,
        [board.id],
      );

      return { areas, cards };
    }

    if (method === "POST") {
      const body = await readBody(event).catch(() => null);
      const type = String((body as any)?.type ?? "");
      const id = Number((body as any)?.id);
      if (!["card", "area", "board"].includes(type) || !Number.isInteger(id) || id <= 0) {
        event.res.statusCode = 400;
        return { error: "Required fields are missing" };
      }

      if (type === "board") {
        const board = await boardOf(db, id);
        if (!board) {
          event.res.statusCode = 404;
          return { error: "Resource not found" };
        }
        // Archiving a board is the owner's alone, and so is undoing it.
        if (board.user !== userId) {
          event.res.statusCode = 403;
          return { error: "Unauthorized access" };
        }
        await db.execute(
          "UPDATE `boards` SET `archivedAt` = NULL WHERE `id` = ?",
          [id],
        );
        // It reappears on the dashboards of everyone who was on it.
        await notifyDashboards(db, id);
        return { success: true };
      }

      // A card and an area are both reached through their board, and both need
      // edit access on it.
      const [rows]: any =
        type === "area"
          ? await db.execute("SELECT `id`, `board` FROM `areas` WHERE `id` = ?", [id])
          : await db.execute(
              "SELECT c.`id`, c.`area`, ar.`board` FROM `cards` c JOIN `areas` ar ON ar.id = c.area WHERE c.`id` = ?",
              [id],
            );
      const row = rows[0];
      if (!row) {
        event.res.statusCode = 404;
        return { error: "Resource not found" };
      }
      const board = await boardOf(db, row.board);
      if (!board) {
        event.res.statusCode = 404;
        return { error: "Resource not found" };
      }
      const decision = await authorizeBoard(db, board, userId, "edit");
      if (!decision.ok) {
        event.res.statusCode = decision.status;
        return { error: decision.error };
      }

      if (type === "area") {
        await db.execute(
          "UPDATE `areas` SET `archivedAt` = NULL WHERE `id` = ?",
          [id],
        );
        return { success: true, boardId: board.id };
      }

      await db.execute("UPDATE `cards` SET `archivedAt` = NULL WHERE `id` = ?", [
        id,
      ]);
      // A card cannot come back to a column that is not there. The archive does
      // not offer these, but two people archiving at once can arrange it, and
      // silently restoring a card to nowhere is worse than bringing its column
      // back with it.
      await db.execute(
        "UPDATE `areas` SET `archivedAt` = NULL WHERE `id` = ? AND `archivedAt` IS NOT NULL",
        [row.area],
      );
      await recordCardActivity(id, "restored", userId);
      return { success: true, boardId: board.id };
    }

    event.res.statusCode = 405;
    return { error: "Method not allowed" };
  } catch (error) {
    logger.error("Database error:", error);
    event.res.statusCode = 500;
    return { error: "Internal server error" };
  }
});
