import { createHmac } from "node:crypto";
import { setupDatabase } from "../../app/lib/databaseSetup";
import { safeFetch, SafeFetchError } from "./safeFetch";
import { authorizeBoard } from "./auth";

// Outgoing webhooks. Subscriptions are per user AND per board: each collaborator
// registers their own endpoint for a board they can access, so on a shared
// instance one party's automation never fires from — or is hijacked by —
// another's. `ignoreOwnActions` (default on) stops an agent's own writes
// re-triggering itself.
//
// Delivery is best-effort and fire-and-forget: a slow or broken endpoint must
// never slow down or fail the user's request.

const db = setupDatabase();
const TIMEOUT_MS = 5000;

export type WebhookEvent =
  | "card.created"
  | "card.updated"
  | "card.moved"
  | "card.deleted"
  | "card.claimed"
  | "comment.created";

interface DispatchOptions {
  boardId: number;
  event: WebhookEvent;
  actorUserId: string;
  card?: any;
  comment?: any;
  extra?: Record<string, unknown>;
}

async function deliver(hook: any, body: string): Promise<void> {
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "user-agent": "LokalBoards webhook",
      "x-lokalboards-event": JSON.parse(body).event,
    };
    // Optional shared secret so the receiver can verify the payload is ours.
    if (hook.secret) {
      headers["x-lokalboards-signature"] =
        "sha256=" +
        createHmac("sha256", hook.secret).update(body).digest("hex");
    }
    // Re-checked per delivery, not just at subscription time: a hostname that
    // resolved publicly yesterday can point at an internal address today.
    // safeFetch checks inside the connection's own DNS lookup, so it is also
    // the address actually connected to. A redirect is not followed — it is
    // reported like any other non-2xx answer, so a 30x cannot bounce the
    // request to an internal address.
    const res = await safeFetch(hook.url, {
      method: "POST",
      headers,
      body,
      timeoutMs: TIMEOUT_MS,
      // Only the status matters; the socket is released at once.
      readBody: false,
    });
    if (!res.ok) {
      logger.error(`Webhook ${hook.id} -> ${hook.url} responded ${res.status}`);
    }
  } catch (err) {
    if (err instanceof SafeFetchError && err.code === "BLOCKED") {
      logger.error(`Webhook ${hook.id} skipped: ${err.reason ?? err.message}`);
      return;
    }
    logger.error(`Webhook ${hook.id} delivery failed:`, err);
  }
}

// Fire the board's webhooks for an event. Never throws and never blocks the
// caller — call it without awaiting.
export function dispatchWebhooks(options: DispatchOptions): void {
  void (async () => {
    try {
      const { boardId, event, actorUserId } = options;
      const [hooks]: any = await db.execute(
        "SELECT * FROM `webhooks` WHERE `board` = ? AND `enabled` = 1",
        [boardId],
      );
      const candidates = hooks.filter(
        (h: any) => !(h.ignoreOwnActions && h.user === actorUserId),
      );
      if (candidates.length === 0) return;

      const [[board]]: any = await db.query(
        "SELECT * FROM `boards` WHERE id = ?",
        [boardId],
      );
      if (!board) return;

      // Access is re-checked on every dispatch, not just when the subscription
      // was created. Otherwise a collaborator who has since been removed from
      // the board — or whose access lapsed when it went private — would keep
      // receiving card and comment content indefinitely.
      const allowed = await Promise.all(
        candidates.map(async (hook: any) => {
          try {
            const decision = await authorizeBoard(db, board, hook.user, "read");
            return decision.ok ? hook : null;
          } catch (err) {
            logger.error(`Webhook ${hook.id} access check failed:`, err);
            return null;
          }
        }),
      );
      const targets = allowed.filter(Boolean);
      if (targets.length === 0) return;
      const [[actor]]: any = await db.query(
        "SELECT id, name, type FROM `user` WHERE id = ?",
        [actorUserId],
      );

      const body = JSON.stringify({
        event,
        timestamp: new Date().toISOString(),
        board: board ? { id: board.id, name: board.name } : { id: boardId },
        actor: actor
          ? { userId: actor.id, name: actor.name, type: actor.type || "human" }
          : { userId: actorUserId },
        ...(options.card ? { card: options.card } : {}),
        ...(options.comment ? { comment: options.comment } : {}),
        ...(options.extra || {}),
      });

      await Promise.all(targets.map((hook: any) => deliver(hook, body)));
    } catch (err) {
      logger.error("Webhook dispatch failed:", err);
    }
  })();
}
