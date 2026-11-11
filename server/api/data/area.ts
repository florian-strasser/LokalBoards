import { readBody } from "h3";
import { archiveArea, createArea, renameArea } from "../../utils/areas";

export default dataHandler({
  // A new area at the end of the board, or — with an `id` — a new name for one.
  async POST({ event, db, viaApiKey, boardOf, areaOf }) {
    const { id, boardId, name } = await readBody(event);
    if (!boardId || !name) fail(400, "Board ID and name are required");
    const { board } = await boardOf(boardId, "edit");

    if (id) {
      const { area } = await areaOf(id, "edit");
      if (area.board !== board.id) fail(404, "Resource not found");
      return { area: await renameArea(db, area, name, viaApiKey) };
    }
    return { area: await createArea(db, board.id, name, viaApiKey) };
  },

  // Into the archive, or — when the archive itself asks — gone for good.
  async DELETE({ db, query, viaApiKey, areaOf }) {
    if (!query.id || !query.boardId) {
      fail(400, "Area ID and board ID are required for DELETE requests");
    }
    const { area } = await areaOf(query.id, "edit");
    if (area.board !== Number(query.boardId)) fail(404, "Resource not found");
    const permanent = String(query.permanent ?? "") === "true";
    await archiveArea(db, area, viaApiKey, permanent);
    return {
      message: permanent ? "Area deleted successfully" : "Area archived successfully",
    };
  },
});
