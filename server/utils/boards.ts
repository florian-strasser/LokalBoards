import { removeBoardCompletely } from "./boardCleanup";
import { getBoardMemberIds } from "./boardMembers";
import { notifyDashboards } from "./dashboardNotify";
import { emitToBoard } from "./socket";
// The same parser the tile and the picker use, so a colour cannot be stored in
// a form the UI would then refuse to render.
import { normalizeBoardColor } from "../../app/utils/boardColor";

// A board made, changed or archived: the one way each is done, whether the
// app, the REST API or an agent over MCP asks for it. The two ways in had
// drifted apart: a change made over MCP never reached the dashboards and left
// the image and the colour out of what it told an open board, and deleting
// over MCP destroyed the board with an old copy of the cleanup that left its
// labels, files and history behind — where the app archives.
//
// Access is the caller's to check first (see access.ts), and so is ownership:
// a board's settings and its archiving are its owner's alone. `broadcast` is
// whether to tell whoever has the board open: a browser tells the others
// itself, so it is the API and MCP that ask for it.

async function boardById(db: any, id: number | string) {
  const [rows]: any = await db.execute("SELECT * FROM boards WHERE id = ?", [id]);
  return rows[0] ?? null;
}

/** What a board is: its name, its layout, who may see it and how its tile looks. */
export interface BoardFields {
  name: string;
  /** "kanban", "todo" or "mindmap". */
  style: string;
  /** "private" or "public". */
  status: string;
  /** A cover image for the tile, or null for none. */
  image?: string | null;
  /** A hex colour for the tile. Anything that is not one is stored as none. */
  color?: string | null;
}

/**
 * A new board, belonging to `ownerId`. A browser that makes one shows it
 * itself; one made with an API key or by an agent is put on the owner's open
 * dashboards when `broadcast` asks for it.
 */
export async function createBoard(
  db: any,
  ownerId: string,
  fields: BoardFields,
  broadcast = false,
) {
  // Anything that isn't a hex colour — including the empty string the app
  // sends for "no colour" — becomes NULL, the default tile. The value ends up
  // in a CSS custom property, so this is the boundary that keeps the
  // stylesheet safe rather than a formatting nicety. A missing image is NULL
  // too: MySQL takes a missing value as an error rather than as no image.
  const [result]: any = await db.execute(
    "INSERT INTO boards (user, name, style, image, color, status) VALUES (?, ?, ?, ?, ?, ?)",
    [
      ownerId,
      fields.name,
      fields.style,
      fields.image ?? null,
      normalizeBoardColor(fields.color),
      fields.status,
    ],
  );
  if (broadcast) await notifyDashboards(db, result.insertId, [ownerId]);
  return boardById(db, result.insertId);
}

/**
 * A board changed. Whatever is left out stays as it is, with one exception: a
 * cover image covers the whole tile, so a colour behind one could never be
 * seen, and setting either clears the other unless both were sent.
 *
 * Returns the board as it now is, or null when it was gone by the time it was
 * written.
 */
export async function updateBoard(
  db: any,
  board: any,
  patch: Partial<BoardFields>,
  broadcast: boolean,
) {
  const color = patch.color === undefined ? undefined : normalizeBoardColor(patch.color);
  const image = patch.image;
  const columns: Record<string, unknown> = {
    name: patch.name,
    style: patch.style,
    status: patch.status,
    image: image === undefined && color ? null : image,
    color: color === undefined && image ? null : color,
  };
  const set = Object.entries(columns).filter(([, value]) => value !== undefined);
  if (set.length) {
    await db.execute(
      `UPDATE boards SET ${set.map(([column]) => `${column} = ?`).join(", ")} WHERE id = ?`,
      [...set.map(([, value]) => value), board.id],
    );
  }

  const updated = await boardById(db, board.id);
  if (!updated) return null;
  emitToBoard(
    board.id,
    "updateBoard",
    {
      boardID: updated.id,
      boardName: updated.name,
      boardStatus: updated.status,
      boardStyle: updated.style,
      boardImage: updated.image,
      boardColor: updated.color,
    },
    broadcast,
  );
  // The tile on every dashboard showing this board is its name and its colour
  // or image, so a change here is a change there. A browser tells the board it
  // has open, never the dashboards, so they are told whoever made the change.
  await notifyDashboards(db, board.id);
  return updated;
}

/**
 * Off every dashboard and into its owner's archive, with everything on it —
 * the areas, the cards, the invitations, the uploaded files — left in place,
 * so it can be restored exactly as it was. With `permanent`, gone for good
 * with all of it: the archive's own "delete", and the same call its nightly
 * sweep makes.
 *
 * Returns false when the board was already gone, so a caller racing another
 * deletion can tell.
 */
export async function archiveBoard(
  db: any,
  board: any,
  broadcast: boolean,
  permanent = false,
) {
  // Who to tell, read before anything is deleted: once the board and its
  // invitations are gone there is no way to work out whose dashboards were
  // showing it.
  const memberIds = await getBoardMemberIds(db, board.id);

  if (permanent) {
    if (!(await removeBoardCompletely(db, Number(board.id)))) return false;
  } else {
    await db.execute(
      "UPDATE boards SET archivedAt = NOW() WHERE id = ? AND archivedAt IS NULL",
      [board.id],
    );
  }

  // The people who were on it are told the same thing either way: from where
  // they are standing the board has gone. Whether it was filed away or
  // destroyed is the owner's business, and the owner is the one who can bring
  // it back.
  emitToBoard(board.id, "deletedBoard", { boardID: board.id }, broadcast);
  await notifyDashboards(db, board.id, memberIds);
  return true;
}
