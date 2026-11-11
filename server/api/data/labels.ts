import { readBody } from "h3";

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

export default dataHandler({
  async GET({ db, query, boardOf }) {
    const { board } = await boardOf(query.boardId, "read");
    const [rows]: any = await db.execute(
      "SELECT `id`, `name` FROM `labels` WHERE `board` = ? ORDER BY `sort` ASC, `id` ASC",
      [board.id],
    );
    return { labels: rows };
  },

  async POST({ event, db, boardOf }) {
    const body = await readBody(event).catch(() => null);
    if (!body || typeof body !== "object") fail(400, "Required fields are missing");
    const { board } = await boardOf(body.boardId, "edit");

    const name = String(body.name ?? "").trim();
    if (!name || name.length > NAME_MAX) fail(400, "Required fields are missing");

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
    if (Number(counted.total) >= PER_BOARD_MAX) fail(400, "TOO_MANY_LABELS");

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
  },
});

const findByName = async (db: any, boardId: number, name: string) => {
  const [rows]: any = await db.execute(
    "SELECT `id`, `name` FROM `labels` WHERE `board` = ? AND `name` = ? LIMIT 1",
    [boardId, name],
  );
  return rows[0] ?? null;
};
