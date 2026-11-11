import { z } from "zod";
import { defineMcpTool } from "@nuxtjs/mcp-toolkit/server";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { assigneeIdsFrom } from "../../utils/cardAssignees";
import { createCard } from "../../utils/cards";
import {
  requireUserId,
  requireArea,
  requireWriteAccess,
  requireMembers,
  requireId,
  dueDateFrom,
  areaIdInput,
  serializeCard,
} from "../../utils/mcpHelpers";

const db = setupDatabase();

export default defineMcpTool({
  name: "createCard",
  title: "Create a card",
  description:
    "Create a card at the end of an area. `content` (the description) is Markdown. Optionally set done, a dueDate (ISO 8601), the people on it (assigneeIds, board members) and a repeat rhythm. Collaborators are notified. Needs edit access to the board.",
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
    assigneeIds: z
      .array(z.string())
      .optional()
      .describe(
        "User ids of the people to put on the card — a card can be on several people. Each must be a board member (see listBoardMembers).",
      ),
    assigneeId: z
      .string()
      .optional()
      .describe(
        "One user id to put on the card; the same as assigneeIds with one entry. Ignored when assigneeIds is given.",
      ),
    repeat: z
      .enum(["day", "week", "twoWeeks", "month", "year"])
      .optional()
      .describe(
        "Make the card repeat: each time the rhythm comes round the next card is created on its own, with its checklist unticked — whether or not this one was done. A dueDate is optional; with one, the next card is made as that date arrives and is due a rhythm later. Pass '' to stop it repeating.",
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
    assigneeIds,
    assigneeId,
    repeat,
    idempotencyKey,
  }) => {
    const userId = requireUserId();
    requireWriteAccess();
    const id = requireId(areaId, areaID, "areaId");
    const { area, board } = await requireArea(id, userId, "edit");
    const due = dueDateFrom(dueDate);
    const people = assigneeIdsFrom(assigneeIds ?? (assigneeId ? [assigneeId] : []));
    await requireMembers(board.id, people);
    const { card, created } = await createCard(
      db,
      { area, board },
      userId,
      { name, content, done, dueDate: due ?? null, repeat, assigneeIds: people, idempotencyKey },
      true,
    );
    return jsonResult({ card: serializeCard(card), created });
  },
});
