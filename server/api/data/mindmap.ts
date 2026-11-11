import { readBody } from "h3";
import { emitToBoard } from "../../utils/socket";
import { clampToMap } from "../../../app/utils/mindMap";

// Where the nodes of a board drawn as a mind map sit.
//
// One request carries everything a drag moved — a card, or an area and the
// cards that followed it — so a branch arrives in one piece rather than as a
// dozen requests the board could be caught halfway through.
//
// Every write is scoped to the board the caller was authorised for, not just to
// the id they sent: that is what stops a member of one board nudging a card on
// another by guessing its number.
const MAX_NODES = 500;

export default dataHandler({
  async POST({ event, db, viaApiKey, boardOf }) {
    const { boardId, nodes } = await readBody(event);
    const id = positiveId(boardId, "Invalid board ID");
    if (!Array.isArray(nodes) || nodes.length === 0) {
      fail(400, "Required fields are missing");
    }
    if (nodes.length > MAX_NODES) fail(400, "Too many nodes");
    const { board } = await boardOf(id, "edit");

    const moved: { kind: string; id: number; x: number; y: number }[] = [];
    for (const node of nodes) {
      const x = clampToMap(node?.x);
      const y = clampToMap(node?.y);
      const nodeId = Number(node?.id);
      if (x === null || y === null) continue;

      if (node?.kind === "board") {
        // The root is the board itself; its id is the board's.
        await db.execute("UPDATE boards SET mapX = ?, mapY = ? WHERE id = ?", [
          x,
          y,
          board.id,
        ]);
        moved.push({ kind: "board", id: Number(board.id), x, y });
      } else if (node?.kind === "area" && Number.isInteger(nodeId) && nodeId > 0) {
        const [result]: any = await db.execute(
          "UPDATE areas SET mapX = ?, mapY = ? WHERE id = ? AND board = ?",
          [x, y, nodeId, board.id],
        );
        if (result.affectedRows) moved.push({ kind: "area", id: nodeId, x, y });
      } else if (node?.kind === "card" && Number.isInteger(nodeId) && nodeId > 0) {
        const [result]: any = await db.execute(
          "UPDATE cards SET mapX = ?, mapY = ? WHERE id = ? AND area IN (SELECT id FROM areas WHERE board = ?)",
          [x, y, nodeId, board.id],
        );
        if (result.affectedRows) moved.push({ kind: "card", id: nodeId, x, y });
      }
    }

    // A browser tells the other boards itself, over its own socket, the way it
    // does for a card it has just moved. Something holding an API key has no
    // socket, so the server says it for them.
    emitToBoard(
      board.id,
      "movedMap",
      { boardId: Number(board.id), nodes: moved },
      viaApiKey && moved.length > 0,
    );

    return { success: true, moved: moved.length };
  },
});
