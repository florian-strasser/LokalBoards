import { z } from "zod";
import { defineMcpTool } from "@nuxtjs/mcp-toolkit/server";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { getServerSocket } from "../../utils/socket";
import { nextCardSort } from "../../utils/cardPositions";
import { dispatchWebhooks } from "../../utils/webhooks";
import {
  requireUserId,
  requireWriteAccess,
  requireArea,
  requireId,
  areaIdInput,
  serializeCard,
  McpError,
} from "../../utils/mcpHelpers";

const db = setupDatabase();

export default defineMcpTool({
  name: "createCard",
  title: "Create a card",
  description:
    "Create a card at the end of an area. `content` (the description) is Markdown. Optionally set done, a dueDate (ISO 8601) and an assigneeId (a board member). Collaborators are notified. Needs edit access to the board.",
  annotations: { readOnlyHint: false, openWorldHint: false },
  inputSchema: {
    ...areaIdInput,
    name: z.string().min(1).describe("The card title."),
    content: z
      .string()
      .optional()
      .describe("The card description, in Markdown."),
    done: z
      .boolean()
      .optional()
      .describe("Create the card already marked done (default false)."),
    dueDate: z
      .string()
      .optional()
      .describe("Due date as ISO 8601 (e.g. 2026-08-01T09:00:00Z)."),
    assigneeId: z
      .string()
      .optional()
      .describe(
        "User id to assign (must be a board member; from listBoardMembers).",
      ),
    idempotencyKey: z
      .string()
      .max(64)
      .optional()
      .describe(
        "Optional key making the create safe to retry: sending the same key for the same area returns the existing card instead of creating a duplicate.",
      ),
  },
  inputExamples: [
    { areaId: 1, name: "Competitor research" },
    {
      areaId: 1,
      name: "Redesign the logo",
      content:
        "Keep it **simple**.\n\n- [ ] collect references\n- [ ] first pass",
      dueDate: "2026-08-01T09:00:00Z",
    },
  ],
  handler: async ({
    areaId,
    areaID,
    name,
    content,
    done,
    dueDate,
    assigneeId,
    idempotencyKey,
  }) => {
    const userId = requireUserId();
    requireWriteAccess();
    const id = requireId(areaId, areaID, "areaId");
    const { board } = await requireArea(id, userId, "edit");

    // Retry-safe: the same key in the same area returns the card made earlier.
    if (idempotencyKey) {
      const [existing]: any = await db.execute(
        "SELECT * FROM cards WHERE area = ? AND idempotencyKey = ?",
        [id, idempotencyKey],
      );
      if (existing[0]) {
        return jsonResult({ card: serializeCard(existing[0]), created: false });
      }
    }

    let due: Date | null = null;
    if (dueDate) {
      const d = new Date(dueDate);
      if (Number.isNaN(d.getTime())) {
        throw new McpError("VALIDATION", "dueDate must be an ISO 8601 date.");
      }
      due = d;
    }
    if (assigneeId) {
      const [[member]]: any = await db.query(
        "SELECT 1 AS ok FROM boards WHERE id = ? AND user = ? UNION SELECT 1 AS ok FROM invitations WHERE board = ? AND user = ? LIMIT 1",
        [board.id, assigneeId, board.id, assigneeId],
      );
      if (!member) {
        throw new McpError(
          "VALIDATION",
          `assigneeId '${assigneeId}' is not a member of this board (see listBoardMembers).`,
        );
      }
    }

    // After the highest number in the column, not after however many cards
    // it has (see `cardPositions`).
    const sort = await nextCardSort(db, id);

    let insertId: number;
    try {
      const [result]: any = await db.execute(
        "INSERT INTO cards (area, name, content, status, sort, dueDate, assignee, idempotencyKey) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
          id,
          name,
          content || "",
          done ? 1 : 0,
          sort,
          due,
          assigneeId || null,
          idempotencyKey || null,
        ],
      );
      insertId = result.insertId;
    } catch (err: any) {
      // Lost a race against a concurrent retry with the same key — return the
      // card that won instead of failing.
      if (err?.code === "ER_DUP_ENTRY" && idempotencyKey) {
        const [existing]: any = await db.execute(
          "SELECT * FROM cards WHERE area = ? AND idempotencyKey = ?",
          [id, idempotencyKey],
        );
        if (existing[0]) {
          return jsonResult({
            card: serializeCard(existing[0]),
            created: false,
          });
        }
      }
      throw err;
    }
    const [rows]: any = await db.execute("SELECT * FROM cards WHERE id = ?", [
      insertId,
    ]);
    const card = rows[0];

    // Notify the board owner + collaborators (except the creator).
    const [invited]: any = await db.execute(
      "SELECT user FROM invitations WHERE board = ?",
      [board.id],
    );
    for (const notifyUserId of [
      board.user,
      ...invited.map((i: any) => i.user),
    ].filter(Boolean)) {
      if (notifyUserId !== userId) {
        await db.execute(
          "INSERT INTO notifications (userId, type, boardId, cardId, message, actorId) VALUES (?, ?, ?, ?, ?, ?)",
          [
            notifyUserId,
            "card_created",
            board.id,
            card.id,
            `New card created: ${card.name}`,
                          userId,
              ],
        );
      }
    }

    const serverSocket = getServerSocket();
    if (serverSocket) {
      serverSocket
        .to(`board-${board.id}`)
        .emit("addCard", { boardId: board.id, card });
    }

    dispatchWebhooks({
      boardId: board.id,
      event: "card.created",
      actorUserId: userId,
      card: serializeCard(card),
    });

    return jsonResult({ card: serializeCard(card), created: true });
  },
});
