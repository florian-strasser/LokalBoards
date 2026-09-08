import { defineEventHandler, getQuery, readBody } from "h3";
import { setupDatabase } from "../../../app/lib/databaseSetup";

// The names a board is using.
//
// A label is text on a card, not an entry in a list the board keeps: you type a
// word on the card it applies to, and the row here exists so that the same word
// typed on two cards is one thing rather than two. That is what a tile draws,
// what a filter groups by, and what fills the handful of names offered the next
// time somebody adds one — "or one that was already used" is the whole reason
// this endpoint exists at all.
//
// So there is no renaming and no deleting here. Changing the text on a card
// points that card at a different name; taking a label off a card is a change
// to the card. Both travel through `card.ts`, which already carries the
// permissions, the broadcast and the activity entry, and which drops a name
// nothing wears any longer.
//
// Reading the list needs read access to the board; adding a name needs edit
// access, the same as adding an area does.

// Long enough to say what a label is for, short enough to stay a chip.
const NAME_MAX = 64;
// Enough for a working board, few enough that the names offered stay a glance
// rather than a list to scroll. Only names actually in use are ever stored, so
// this counts labels somebody is using, not labels somebody once typed.
const PER_BOARD_MAX = 30;

// Every label is drawn in the brand colour; nobody picks one. The column stays
// because a colour per label is a fair thing to want back, and a table that
// already has the room for it beats a migration on the day it returns — but it
// is written here and read nowhere, so the app cannot drift into showing two
// different answers for what colour a label is. That answer lives in
// `.label-pill` in `main.css`, in one place, in both themes.
const LABEL_COLOR = "#0066cc";

const loadBoard = async (db: any, boardId: unknown) => {
  if (!boardId || isNaN(Number(boardId)) || Number(boardId) <= 0) return null;
  const [rows]: any = await db.execute("SELECT * FROM boards WHERE id = ?", [
    Number(boardId),
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
      const board = await loadBoard(db, query.boardId);
      if (!board) {
        event.res.statusCode = 404;
        return { error: "Resource not found" };
      }
      const decision = await authorizeBoard(db, board, userId, "read");
      if (!decision.ok) {
        event.res.statusCode = decision.status;
        return { error: decision.error };
      }

      const [rows]: any = await db.execute(
        "SELECT `id`, `name` FROM `labels` WHERE `board` = ? ORDER BY `sort` ASC, `id` ASC",
        [board.id],
      );
      return { labels: rows };
    }

    if (method === "POST") {
      const body = await readBody(event).catch(() => null);
      if (!body || typeof body !== "object") {
        event.res.statusCode = 400;
        return { error: "Required fields are missing" };
      }

      const board = await loadBoard(db, (body as any).boardId);
      if (!board) {
        event.res.statusCode = 404;
        return { error: "Resource not found" };
      }
      const decision = await authorizeBoard(db, board, userId, "edit");
      if (!decision.ok) {
        event.res.statusCode = decision.status;
        return { error: decision.error };
      }

      const name = String((body as any).name ?? "").trim();
      if (!name || name.length > NAME_MAX) {
        event.res.statusCode = 400;
        return { error: "Required fields are missing" };
      }

      // Already in use on this board? Then that is the label, and this is not a
      // new one. The comparison is MySQL's own under `utf8mb4_general_ci`, so
      // "Bug" and "bug" are the same word — which is what somebody typing the
      // second one means, and stops a board holding both.
      const existing = await findByName(db, board.id, name);
      if (existing) return { label: existing };

      const [[counted]]: any = await db.execute(
        "SELECT COUNT(*) AS total FROM `labels` WHERE `board` = ?",
        [board.id],
      );
      if (Number(counted.total) >= PER_BOARD_MAX) {
        event.res.statusCode = 400;
        return { error: "TOO_MANY_LABELS" };
      }

      const [[last]]: any = await db.execute(
        "SELECT COALESCE(MAX(`sort`), -1) AS highest FROM `labels` WHERE `board` = ?",
        [board.id],
      );

      try {
        const [result]: any = await db.execute(
          "INSERT INTO `labels` (`board`, `name`, `color`, `sort`) VALUES (?, ?, ?, ?)",
          [board.id, name, LABEL_COLOR, Number(last.highest) + 1],
        );
        return { label: { id: result.insertId, name } };
      } catch (error: any) {
        // Somebody else typed the same word between the lookup above and this
        // insert. The unique key is what stopped the board ending up with two,
        // and theirs is now the label — so answer with it rather than failing a
        // request that asked for exactly that.
        if (error?.code !== "ER_DUP_ENTRY") throw error;
        const raced = await findByName(db, board.id, name);
        if (raced) return { label: raced };
        throw error;
      }
    }

    event.res.statusCode = 405;
    return { error: "Method not allowed" };
  } catch (error) {
    logger.error("Database error:", error);
    event.res.statusCode = 500;
    return { error: "Internal server error" };
  }
});

const findByName = async (db: any, boardId: number, name: string) => {
  const [rows]: any = await db.execute(
    "SELECT `id`, `name` FROM `labels` WHERE `board` = ? AND `name` = ? LIMIT 1",
    [boardId, name],
  );
  return rows[0] ?? null;
};
