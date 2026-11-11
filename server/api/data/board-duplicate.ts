import { readBody } from "h3";
import { createBoard } from "../../utils/boards";

// A board's structure, again, under a new name.
//
// The board and its columns come across; the cards do not. That is the whole
// feature: most boards start life as the same three or four columns, and
// building them by hand every time is the part worth skipping.
//
// Seeing a board is enough to take a copy of its shape — the copy is a new
// board of your own, holding nothing but column names.

const NAME_MAX = 255;

export default dataHandler({
  async POST({ event, db, userId, boardOf }) {
    const body = await readBody(event).catch(() => null);
    const boardId = Number(body?.boardId);
    const name = String(body?.name ?? "").trim();
    if (!Number.isInteger(boardId) || boardId <= 0 || !name || name.length > NAME_MAX) {
      fail(400, "Required fields are missing");
    }
    const { board: source } = await boardOf(boardId, "read");

    // The copy belongs to whoever asked for it, not to whoever owns the
    // original, and it is private until they say otherwise: a new board with
    // nothing in it is nobody else's business yet.
    const board = await createBoard(db, userId, {
      name,
      style: source.style ?? "kanban",
      status: "private",
      image: source.image ?? null,
      color: source.color,
    });

    // The columns as they stand. An archived one is not part of the board's
    // shape any more, so it is not part of the copy.
    const [areas]: any = await db.execute(
      "SELECT `name`, `sort` FROM `areas` WHERE `board` = ? AND `archivedAt` IS NULL ORDER BY `sort` ASC, `id` ASC",
      [source.id],
    );
    for (const area of areas) {
      await db.execute(
        "INSERT INTO `areas` (`board`, `name`, `sort`) VALUES (?, ?, ?)",
        [board.id, area.name, area.sort],
      );
    }

    await notifyDashboards(db, board.id, [userId]);

    return {
      board: {
        id: board.id,
        name: board.name,
        style: board.style,
        image: board.image,
        color: board.color,
        status: board.status,
      },
      areas: areas.length,
    };
  },
});
