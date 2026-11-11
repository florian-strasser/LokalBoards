import { z } from "zod";
import { defineMcpTool } from "@nuxtjs/mcp-toolkit/server";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { assigneeIdsFrom } from "../../utils/cardAssignees";
import { updateCard } from "../../utils/cards";
import {
  requireUserId,
  requireWriteAccess,
  requireCard,
  requireMembers,
  requireId,
  dueDateFrom,
  cardIdInput,
  serializeCard,
  McpError,
} from "../../utils/mcpHelpers";

const db = setupDatabase();

export default defineMcpTool({
  name: "updateCard",
  title: "Update a card",
  description:
    "Update fields of an existing card. Only the fields you pass are changed (partial update); pass at least one. `content` is Markdown. Set `dueDate` to an empty string to clear it. `assigneeIds` sets everyone on the card (a card can be on several people; [] takes everybody off). Needs edit access to the board.",
  annotations: {
    readOnlyHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    ...cardIdInput,
    name: z.string().min(1).optional().describe("New card title."),
    content: z
      .string()
      .optional()
      .describe("New description, in Markdown. Pass '' to clear it."),
    done: z
      .boolean()
      .optional()
      .describe("Mark the card done (true) or open (false)."),
    status: z.boolean().optional().describe("Deprecated alias for done."),
    dueDate: z
      .string()
      .optional()
      .describe(
        "Due date as ISO 8601 (e.g. 2026-08-01T09:00:00Z), or '' to clear.",
      ),
    assigneeIds: z
      .array(z.string())
      .optional()
      .describe(
        "User ids of everyone who should be on the card — replaces the people on it; [] takes everybody off. Each must be a board member (see listBoardMembers).",
      ),
    assigneeId: z
      .string()
      .optional()
      .describe(
        "One user id to be the only person on the card, or '' to take everybody off. Ignored when assigneeIds is given.",
      ),
    repeat: z
      .enum(["day", "week", "twoWeeks", "month", "year", ""])
      .optional()
      .describe(
        "Make the card repeat: each time the rhythm comes round the next card is created on its own, with its checklist unticked — whether or not this one was done. A due date is optional; with one, the next card is made as that date arrives and is due a rhythm later. Pass '' to stop it repeating.",
      ),
  },
  inputExamples: [
    { cardId: 1, done: true },
    {
      cardId: 2,
      name: "Redesign the logo",
      content: "Keep it **simple**.\n\n- [ ] first pass",
    },
    { cardId: 3, dueDate: "2026-08-01T09:00:00Z", assigneeIds: ["u-ben", "u-ada"] },
    { cardId: 4, dueDate: "2026-08-03T09:00:00Z", repeat: "week" },
  ],
  handler: async ({
    cardId,
    cardID,
    name,
    content,
    done,
    status,
    dueDate,
    assigneeIds,
    assigneeId,
    repeat,
  }) => {
    const userId = requireUserId();
    requireWriteAccess();
    const id = requireId(cardId, cardID, "cardId");
    const found = await requireCard(id, userId, "edit");

    // Who is on it: `assigneeIds` replaces everyone, `assigneeId` replaces
    // everyone with one person ('' for nobody). Left out, nobody changes.
    const people =
      assigneeIds !== undefined
        ? assigneeIdsFrom(assigneeIds)
        : assigneeId !== undefined
          ? assigneeIdsFrom(assigneeId === "" ? [] : [assigneeId])
          : undefined;
    if (people) await requireMembers(found.board.id, people);

    const patch = {
      name,
      content,
      done: done ?? status,
      dueDate: dueDateFrom(dueDate),
      repeat,
      assigneeIds: people,
    };
    if (Object.values(patch).every((value) => value === undefined)) {
      throw new McpError("VALIDATION", "Provide at least one field to update.");
    }
    const card = await updateCard(db, found, userId, patch, true);
    return jsonResult({ card: serializeCard(card) });
  },
});
