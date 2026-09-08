import { z } from "zod";
import { defineMcpTool } from "@nuxtjs/mcp-toolkit/server";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import {
  requireUserId,
  requireBoard,
  serializeCard,
} from "../../utils/mcpHelpers";

const db = setupDatabase();

export default defineMcpTool({
  name: "searchCards",
  title: "Search / filter cards",
  description:
    "Find cards across every board the user can access, by text and/or filters. All arguments are optional and combine with AND. Omit `query` to filter only — e.g. `{ areaId, done: false, unassigned: true }` is the standard way to find work to pick up. Each result carries its boardId, boardName, areaId and areaName plus the current assignee, so you know where it lives and whether anyone holds it.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: {
    query: z
      .string()
      .optional()
      .describe(
        "Text to match in the card name or Markdown content (case-insensitive).",
      ),
    boardId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Limit to this board."),
    areaId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Limit to this area (column)."),
    done: z
      .boolean()
      .optional()
      .describe("true = only completed cards, false = only open cards."),
    assigneeId: z
      .string()
      .optional()
      .describe(
        "Only cards assigned to this user id (use whoami's userId for your own).",
      ),
    unassigned: z
      .boolean()
      .optional()
      .describe("true = only cards nobody has claimed/been assigned."),
    dueBefore: z
      .string()
      .optional()
      .describe("Only cards with a due date before this ISO 8601 timestamp."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Maximum results (default 25, max 100)."),
  },
  inputExamples: [
    { areaId: 1, done: false, unassigned: true },
    { query: "logo" },
    { assigneeId: "u-agent", done: false },
  ],
  handler: async ({
    query,
    boardId,
    areaId,
    done,
    assigneeId,
    unassigned,
    dueBefore,
    limit,
  }) => {
    const userId = requireUserId();
    if (boardId) await requireBoard(boardId, userId, "read");
    // Clamped rather than trusted: the value is inlined into the SQL (LIMIT is not
    // bindable), so it must be an integer no matter what reaches the handler.
    const max = Math.min(100, Math.max(1, Math.trunc(Number(limit)) || 25));

    // params holds the WHERE values only; the invitations join's userId is
    // prepended at call time (it comes first in the statement).
    const where: string[] = ["(b.user = ? OR inv.user IS NOT NULL)"];
    const params: any[] = [userId];
    if (boardId) {
      where.push("b.id = ?");
      params.push(boardId);
    }
    if (areaId) {
      where.push("c.area = ?");
      params.push(areaId);
    }
    if (query) {
      // A label is one of the words a card is findable by, the same as its name
      // and its description — searching for "Bug" should turn up the cards
      // marked Bug, not nothing.
      where.push(
        "(c.name LIKE ? OR c.content LIKE ? OR EXISTS (SELECT 1 FROM `card_labels` cl JOIN `labels` l ON l.id = cl.label WHERE cl.card = c.id AND l.name LIKE ?))",
      );
      params.push(`%${query}%`, `%${query}%`, `%${query}%`);
    }
    if (done !== undefined) {
      where.push("c.status = ?");
      params.push(done ? 1 : 0);
    }
    if (unassigned) where.push("c.assignee IS NULL");
    if (assigneeId) {
      where.push("c.assignee = ?");
      params.push(assigneeId);
    }
    if (dueBefore) {
      const d = new Date(dueBefore);
      if (!Number.isNaN(d.getTime())) {
        where.push("c.dueDate IS NOT NULL AND c.dueDate < ?");
        params.push(d);
      }
    }

    const [rows]: any = await db.execute(
      `SELECT c.*, b.id AS boardId, b.name AS boardName, ar.name AS areaName,
              u.name AS assigneeName, u.type AS assigneeType
       FROM cards c
       JOIN areas ar ON ar.id = c.area
       JOIN boards b ON b.id = ar.board
       LEFT JOIN invitations inv ON inv.board = b.id AND inv.user = ?
       LEFT JOIN \`user\` u ON u.id = c.assignee
       WHERE ${where.join(" AND ")}
       ORDER BY c.sort ASC, c.id ASC
       LIMIT ${max}`,
      // the invitations join takes the first userId, then the WHERE params
      [userId, ...params],
    );

    // The labels each hit wears, so a caller that searched by one can see it,
    // and one that did not still knows what the card says about itself.
    const labelsByCard = new Map<number, string[]>();
    if (rows.length > 0) {
      const ph = rows.map(() => "?").join(",");
      const [labelRows]: any = await db.execute(
        `SELECT cl.card AS card, l.name
           FROM \`card_labels\` cl JOIN \`labels\` l ON l.id = cl.label
          WHERE cl.card IN (${ph}) ORDER BY l.sort ASC, l.id ASC`,
        rows.map((row: any) => row.id),
      );
      for (const row of labelRows as any[]) {
        if (!labelsByCard.has(row.card)) labelsByCard.set(row.card, []);
        labelsByCard.get(row.card)!.push(row.name);
      }
    }

    return jsonResult({
      count: rows.length,
      cards: rows.map((row: any) => ({
        ...serializeCard(row),
        boardId: row.boardId,
        boardName: row.boardName,
        areaName: row.areaName,
        assigneeName: row.assigneeName ?? null,
        assigneeType: row.assigneeType ?? null,
        labels: labelsByCard.get(row.id) || [],
      })),
    });
  },
});
