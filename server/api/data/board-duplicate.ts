import { defineEventHandler, readBody } from "h3";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { normalizeBoardColor } from "../../../app/utils/boardColor";

// A board's structure, again, under a new name.
//
// The board and its columns come across; the cards do not. That is the whole
// feature: most boards start life as the same three or four columns, and
// building them by hand every time is the part worth skipping.
//
// Seeing a board is enough to take a copy of its shape — the copy is a new
// board of your own, holding nothing but column names.

const NAME_MAX = 255;

export default defineEventHandler(async (event) => {
  if (event.req.method !== "POST") {
    event.res.statusCode = 405;
    return { error: "Method not allowed" };
  }

  const auth = await resolveUserId(event);
  if (!auth.ok) {
    event.res.statusCode = auth.status;
    return { error: auth.error };
  }
  const userId = auth.userId;
  const db = setupDatabase();

  try {
    const body = await readBody(event).catch(() => null);
    const boardId = Number((body as any)?.boardId);
    const name = String((body as any)?.name ?? "").trim();

    if (!Number.isInteger(boardId) || boardId <= 0 || !name || name.length > NAME_MAX) {
      event.res.statusCode = 400;
      return { error: "Required fields are missing" };
    }

    const [rows]: any = await db.execute("SELECT * FROM boards WHERE id = ?", [
      boardId,
    ]);
    const source = rows[0];
    if (!source) {
      event.res.statusCode = 404;
      return { error: "Resource not found" };
    }

    const decision = await authorizeBoard(db, source, userId, "read");
    if (!decision.ok) {
      event.res.statusCode = decision.status;
      return { error: decision.error };
    }

    // The copy belongs to whoever asked for it, not to whoever owns the
    // original, and it is private until they say otherwise: a new board with
    // nothing in it is nobody else's business yet.
    const [created]: any = await db.execute(
      "INSERT INTO boards (user, name, style, image, color, status) VALUES (?, ?, ?, ?, ?, ?)",
      [
        userId,
        name,
        source.style ?? "kanban",
        source.image ?? null,
        normalizeBoardColor(source.color),
        "private",
      ],
    );
    const newBoardId = created.insertId;

    // The columns as they stand. An archived one is not part of the board's
    // shape any more, so it is not part of the copy.
    const [areas]: any = await db.execute(
      "SELECT `name`, `sort` FROM `areas` WHERE `board` = ? AND `archivedAt` IS NULL ORDER BY `sort` ASC, `id` ASC",
      [boardId],
    );
    for (const area of areas as any[]) {
      await db.execute(
        "INSERT INTO `areas` (`board`, `name`, `sort`) VALUES (?, ?, ?)",
        [newBoardId, area.name, area.sort],
      );
    }

    await notifyDashboards(db, newBoardId, [userId]);

    return {
      board: {
        id: newBoardId,
        name,
        style: source.style ?? "kanban",
        image: source.image ?? null,
        color: normalizeBoardColor(source.color),
        status: "private",
      },
      areas: areas.length,
    };
  } catch (error) {
    logger.error("Database error:", error);
    event.res.statusCode = 500;
    return { error: "Internal server error" };
  }
});
