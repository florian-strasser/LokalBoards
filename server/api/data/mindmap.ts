import { defineEventHandler, readBody } from "h3";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { getServerSocket } from "../../utils/socket";
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

  try {
    const db = setupDatabase();
    const { boardId, nodes } = await readBody(event);

    if (!boardId || isNaN(Number(boardId)) || Number(boardId) <= 0) {
      event.res.statusCode = 400;
      return { error: "Invalid board ID" };
    }
    if (!Array.isArray(nodes) || nodes.length === 0) {
      event.res.statusCode = 400;
      return { error: "Required fields are missing" };
    }
    if (nodes.length > MAX_NODES) {
      event.res.statusCode = 400;
      return { error: "Too many nodes" };
    }

    const [boardRows]: any = await db.execute(
      "SELECT * FROM boards WHERE id = ?",
      [boardId],
    );
    const board = boardRows[0];
    if (!board) {
      event.res.statusCode = 404;
      return { error: "Resource not found" };
    }

    const writeDecision = await authorizeBoard(db, board, auth.userId, "edit");
    if (!writeDecision.ok) {
      event.res.statusCode = writeDecision.status;
      return { error: writeDecision.error };
    }

    const moved: { kind: string; id: number; x: number; y: number }[] = [];
    for (const node of nodes) {
      const x = clampToMap(node?.x);
      const y = clampToMap(node?.y);
      const id = Number(node?.id);
      if (x === null || y === null) continue;

      if (node?.kind === "board") {
        // The root is the board itself; its id is the board's.
        await db.execute("UPDATE boards SET mapX = ?, mapY = ? WHERE id = ?", [
          x,
          y,
          board.id,
        ]);
        moved.push({ kind: "board", id: Number(board.id), x, y });
      } else if (node?.kind === "area" && Number.isInteger(id) && id > 0) {
        const [res]: any = await db.execute(
          "UPDATE areas SET mapX = ?, mapY = ? WHERE id = ? AND board = ?",
          [x, y, id, board.id],
        );
        if (res.affectedRows) moved.push({ kind: "area", id, x, y });
      } else if (node?.kind === "card" && Number.isInteger(id) && id > 0) {
        const [res]: any = await db.execute(
          "UPDATE cards SET mapX = ?, mapY = ? WHERE id = ? AND area IN (SELECT id FROM areas WHERE board = ?)",
          [x, y, id, board.id],
        );
        if (res.affectedRows) moved.push({ kind: "card", id, x, y });
      }
    }

    // A browser tells the other boards itself, over its own socket, the way it
    // does for a card it has just moved. Something holding an API key has no
    // socket, so the server says it for them.
    if (auth.viaApiKey && moved.length) {
      try {
        getServerSocket()
          ?.to(`board-${board.id}`)
          .emit("movedMap", { boardId: Number(board.id), nodes: moved });
      } catch {}
    }

    return { success: true, moved: moved.length };
  } catch (error) {
    logger.error("Database error:", error);
    event.res.statusCode = 500;
    return { error: "Internal server error" };
  }
});
