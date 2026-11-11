import { readBody } from "h3";
import { orderAreas } from "../../utils/areas";
import { archiveBoard, createBoard, updateBoard } from "../../utils/boards";

export default dataHandler({
  // One board, and whether the caller may change what is on it.
  async GET({ query, boardOf }) {
    const { board, access } = await boardOf(query.id, "read");
    return { board, writeAccess: access === "edit" };
  },

  // A new board, or — with an `id` — new settings for one. The settings are
  // replaced as a whole: an image or a colour left out is taken away.
  async POST({ event, db, userId, viaApiKey, boardOf }) {
    const { id, userId: ownerId, name, style, image, color, status } =
      await readBody(event);
    if (!ownerId || !name || !style || !status) {
      fail(400, "Required fields are missing");
    }
    // The owner named in the body has to be the caller: nobody makes or
    // changes a board in somebody else's name.
    if (ownerId !== userId) fail(403, "Unauthorized access");

    const fields = { name, style, status, image: image ?? null, color: color ?? null };
    if (!id) return { board: await createBoard(db, userId, fields, viaApiKey) };

    const { board } = await boardOf(id, "edit");
    // A board's settings are its owner's alone, even when somebody else may
    // edit what is on it. They can see the board, so saying so leaks nothing.
    if (board.user !== userId) fail(403, "Unauthorized access");
    const updated = await updateBoard(db, board, fields, viaApiKey);
    if (!updated) fail(404, "Resource not found or access denied");
    return { board: updated };
  },

  // Into the owner's archive, or — when the archive itself asks — gone for
  // good with everything on it.
  async DELETE({ db, query, userId, viaApiKey, boardOf }) {
    const { board } = await boardOf(query.id, "edit");
    if (board.user !== userId) fail(403, "Unauthorized access");
    const permanent = String(query.permanent ?? "") === "true";
    if (!(await archiveBoard(db, board, viaApiKey, permanent))) {
      fail(404, "Resource not found or already deleted");
    }
    return {
      message: permanent ? "Board deleted successfully" : "Board archived successfully",
    };
  },

  // The board's areas in a new order: the whole order, not one move. Each area
  // may be sent as its id or as the area itself, which is what the app sends.
  async PATCH({ event, db, viaApiKey, boardOf }) {
    const { boardId, areas } = await readBody(event);
    if (!Array.isArray(areas)) fail(400, "Invalid request parameters");
    const { board } = await boardOf(boardId, "edit");
    // Checked before anything is changed: an order naming an area that is not
    // the board's is refused whole, not half applied.
    const ordered = await orderAreas(
      db,
      board.id,
      areas.map((area: any) => Number(area?.id ?? area)),
      viaApiKey,
    );
    if (!ordered) fail(404, "Resource not found or access denied");
    return { message: "Area order updated successfully" };
  },
});
