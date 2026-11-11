import { z } from "zod";
import { defineMcpTool } from "@nuxtjs/mcp-toolkit/server";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { attachAssignees } from "../../utils/cardAssignees";
import { cardFilter, labelsOn } from "../../utils/cardLists";
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
    "Find cards across every board the user can access, by text and/or filters. All arguments are optional and combine with AND. Omit `query` to filter only — e.g. `{ areaId, done: false, unassigned: true }` is the standard way to find work to pick up. Each result carries its boardId, boardName, areaId and areaName plus everyone on it (assignees), so you know where it lives and whether anyone holds it.",
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
        "Only cards this user id is on, alone or with others (use whoami's userId for your own).",
      ),
    unassigned: z
      .boolean()
      .optional()
      .describe("true = only cards nobody is on (nobody has claimed or been assigned)."),
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

    // The same filter GET /api/data/cards applies, on the boards the caller
    // owns or was invited to. Archived work, whole boards of it included, is
    // not what an agent is being asked to look through.
    const filter = cardFilter({
      text: query,
      boardId,
      areaId,
      done,
      assigneeId,
      unassigned,
      dueBefore,
      openBoard: true,
    });
    const [found]: any = await db.execute(
      `SELECT c.*, b.id AS boardId, b.name AS boardName, ar.name AS areaName
       FROM cards c
       JOIN areas ar ON ar.id = c.area
       JOIN boards b ON b.id = ar.board
       LEFT JOIN invitations inv ON inv.board = b.id AND inv.user = ?
       WHERE (b.user = ? OR inv.user IS NOT NULL) AND ${filter.where}
       ORDER BY c.sort ASC, c.id ASC
       LIMIT ${max}`,
      [userId, userId, ...filter.params],
    );
    const rows = await attachAssignees(db, found);

    // The labels each hit wears, so a caller that searched by one can see it,
    // and one that did not still knows what the card says about itself.
    const labels = await labelsOn(db, rows.map((row: any) => row.id));

    return jsonResult({
      count: rows.length,
      cards: rows.map((row: any) => ({
        ...serializeCard(row),
        boardId: row.boardId,
        boardName: row.boardName,
        areaName: row.areaName,
        // The first person on it, by name — the older field. Everyone on it
        // is in `assignees`.
        assigneeName: row.assigneeName ?? null,
        assigneeType: row.assigneeType ?? null,
        assignees: row.assignees.map((person: any) => ({
          userId: person.id,
          name: person.name ?? null,
          type: person.type ?? "human",
        })),
        labels: (labels.get(row.id) ?? []).map((label) => label.name),
      })),
    });
  },
});
