import { readBody } from "h3";
import { checkWebhookTarget } from "../../utils/webhookTarget";

// Manage the caller's OWN webhook subscriptions. A subscription is per user and
// per board, so each collaborator wires up their own automation for a board they
// can access without touching anyone else's. A subscription can only ever send
// data the subscriber could already read.
export default dataHandler({
  async GET({ db, userId }) {
    const [rows]: any = await db.execute(
      `SELECT w.id, w.board, w.url, w.ignoreOwnActions, w.enabled, w.createdAt,
              (w.secret IS NOT NULL) AS hasSecret, b.name AS boardName
       FROM \`webhooks\` w JOIN \`boards\` b ON b.id = w.board
       WHERE w.user = ? ORDER BY w.id DESC`,
      [userId],
    );
    return {
      webhooks: rows.map((r: any) => ({
        id: r.id,
        boardId: r.board,
        boardName: r.boardName,
        url: r.url,
        ignoreOwnActions: !!r.ignoreOwnActions,
        enabled: !!r.enabled,
        hasSecret: !!r.hasSecret,
        createdAt: r.createdAt,
      })),
    };
  },

  async POST({ event, db, userId, boardOf }) {
    const body = await readBody(event).catch(() => null);
    if (!body || typeof body !== "object") fail(400, "INVALID_BODY");
    const { url, secret, ignoreOwnActions = true } = body;
    const boardId = positiveId(body.boardId, "INVALID_BOARD");

    // http(s) only, and the host must not resolve into the instance's own
    // network — the server is the one making this request.
    const target = await checkWebhookTarget(url);
    if (!target.ok) fail(400, "INVALID_URL", { message: target.reason });
    if (secret && (typeof secret !== "string" || secret.length > 128)) {
      fail(400, "INVALID_SECRET");
    }

    // You may only subscribe to a board you can actually read.
    const { board } = await boardOf(boardId, "read");

    const [result]: any = await db.execute(
      "INSERT INTO `webhooks` (`user`, `board`, `url`, `secret`, `ignoreOwnActions`) VALUES (?, ?, ?, ?, ?)",
      [userId, board.id, url, secret || null, ignoreOwnActions ? 1 : 0],
    );
    return {
      success: true,
      webhook: {
        id: result.insertId,
        boardId: board.id,
        boardName: board.name,
        url,
        ignoreOwnActions: !!ignoreOwnActions,
        enabled: true,
        hasSecret: !!secret,
      },
    };
  },

  async DELETE({ db, query, userId }) {
    const id = positiveId(query.id, "INVALID_ID");
    // Scoped to the caller — you can only delete your own subscription.
    const [result]: any = await db.execute(
      "DELETE FROM `webhooks` WHERE id = ? AND `user` = ?",
      [id, userId],
    );
    if (result.affectedRows === 0) fail(404, "Resource not found");
    return { success: true, id };
  },
});
