import { readBody } from "h3";
import { notifyDashboards } from "../../utils/dashboardNotify";
import { retentionDays } from "../../utils/archiveRetention";

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

const TYPES = ["card", "area", "board"];

export default dataHandler({
  async GET({ db, userId, query, boardOf }) {
    // Without a board: the boards this account has archived. Only the owner
    // archives a board, so only the owner has one to find.
    if (!query.boardId) {
      const [boards]: any = await db.execute(
        "SELECT `id`, `name`, `archivedAt` FROM `boards` WHERE `user` = ? AND `archivedAt` IS NOT NULL ORDER BY `archivedAt` DESC",
        [userId],
      );
      return { boards, retentionDays: retentionDays() };
    }

    // Reading the archive is the first half of restoring from it, so it takes
    // the same access as putting something in it did.
    const { board } = await boardOf(query.boardId, "edit");

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

    return { areas, cards, retentionDays: retentionDays() };
  },

  async POST({ event, db, userId, boardOf, areaOf, cardOf }) {
    const body = await readBody(event).catch(() => null);
    const type = String(body?.type ?? "");
    const id = Number(body?.id);
    if (!TYPES.includes(type) || !Number.isInteger(id) || id <= 0) {
      fail(400, "Required fields are missing");
    }

    if (type === "board") {
      const { board } = await boardOf(id, "edit");
      // Archiving a board is the owner's alone, and so is undoing it.
      if (board.user !== userId) fail(403, "Unauthorized access");
      await db.execute("UPDATE `boards` SET `archivedAt` = NULL WHERE `id` = ?", [
        id,
      ]);
      // It reappears on the dashboards of everyone who was on it.
      await notifyDashboards(db, id);
      return { success: true };
    }

    // A card and an area are both reached through their board, and both need
    // edit access on it.
    if (type === "area") {
      const { board } = await areaOf(id, "edit");
      await db.execute("UPDATE `areas` SET `archivedAt` = NULL WHERE `id` = ?", [
        id,
      ]);
      return { success: true, boardId: board.id };
    }

    const { card, board } = await cardOf(id, "edit");
    await db.execute("UPDATE `cards` SET `archivedAt` = NULL WHERE `id` = ?", [
      id,
    ]);
    // A card cannot come back to a column that is not there. The archive does
    // not offer these, but two people archiving at once can arrange it, and
    // silently restoring a card to nowhere is worse than bringing its column
    // back with it.
    await db.execute(
      "UPDATE `areas` SET `archivedAt` = NULL WHERE `id` = ? AND `archivedAt` IS NOT NULL",
      [card.area],
    );
    await recordCardActivity(id, "restored", userId);
    return { success: true, boardId: board.id };
  },
});
