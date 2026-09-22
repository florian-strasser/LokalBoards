import { z } from "zod";
import { defineMcpTool } from "@nuxtjs/mcp-toolkit/server";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { getServerSocket } from "../../utils/socket";
import { dispatchWebhooks } from "../../utils/webhooks";
import { repeatAfterEdit } from "../../utils/repeat";
import {
  assigneeIdsFrom,
  attachAssignees,
  boardMemberIds,
  setCardAssignees,
} from "../../utils/cardAssignees";
import { repeatCard } from "../../utils/repeatCard";
import {
  requireUserId,
  requireWriteAccess,
  requireCard,
  requireId,
  cardIdInput,
  serializeCard,
  McpError,
} from "../../utils/mcpHelpers";

const db = setupDatabase();

export default defineMcpTool({
  name: "updateCard",
  title: "Update a card",
  description:
    "Update fields of an existing card. Only the fields you pass are changed (partial update); pass at least one. `content` is Markdown. Set `dueDate` to an empty string to clear it. `assigneeIds` sets everyone on the card (a card can be on several people; [] takes everybody off). Marking a repeating card done creates the next one, returned as `next`. Needs edit access to the board.",
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
        "Make the card repeat: once it is marked done, the next one is created with its checklist unticked and the next due date in the series. Needs a due date. Pass '' to stop it repeating.",
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
    const { card, board } = await requireCard(id, userId, "edit");

    const doneVal = done ?? status;
    const fields: string[] = [];
    const values: any[] = [];
    if (name !== undefined) {
      fields.push("name = ?");
      values.push(name);
    }
    if (content !== undefined) {
      fields.push("content = ?");
      values.push(content);
    }
    if (doneVal !== undefined) {
      fields.push("status = ?");
      values.push(doneVal ? 1 : 0);
    }
    if (dueDate !== undefined) {
      if (dueDate === "") {
        fields.push("dueDate = ?");
        values.push(null);
      } else {
        const d = new Date(dueDate);
        if (Number.isNaN(d.getTime())) {
          throw new McpError(
            "VALIDATION",
            "dueDate must be an ISO 8601 date or ''.",
          );
        }
        fields.push("dueDate = ?");
        values.push(d);
      }
    }
    // Who is on it: `assigneeIds` replaces everyone, `assigneeId` replaces
    // everyone with one person ('' for nobody). Left out, nobody changes.
    const people =
      assigneeIds !== undefined
        ? assigneeIdsFrom(assigneeIds)
        : assigneeId !== undefined
          ? assigneeIdsFrom(assigneeId === "" ? [] : [assigneeId])
          : null;
    if (people) {
      const members = await boardMemberIds(db, board.id);
      const stranger = people.find((person) => !members.has(person));
      if (stranger) {
        throw new McpError(
          "VALIDATION",
          `'${stranger}' is not a member of this board (see listBoardMembers).`,
        );
      }
    }

    // The rhythm belongs to the due date, so either of them changing can
    // change it (see `server/utils/repeat.ts`).
    if (repeat !== undefined || dueDate !== undefined) {
      const due =
        dueDate === undefined
          ? card.dueDate
            ? new Date(card.dueDate)
            : null
          : dueDate === ""
            ? null
            : new Date(dueDate);
      if (repeat && !due) {
        throw new McpError(
          "VALIDATION",
          "A card needs a due date to repeat. Pass dueDate as well.",
        );
      }
      const before = card.dueDate ? new Date(card.dueDate).getTime() : null;
      const state = repeatAfterEdit(
        card,
        repeat,
        due,
        dueDate !== undefined && (due ? due.getTime() : null) !== before,
      );
      fields.push("repeatEvery = ?", "repeatAnchor = ?", "repeatArea = ?");
      values.push(state.repeatEvery, state.repeatAnchor, state.repeatArea);
    }

    if (fields.length === 0 && people === null) {
      throw new McpError("VALIDATION", "Provide at least one field to update.");
    }

    if (fields.length) {
      await db.execute(`UPDATE cards SET ${fields.join(", ")} WHERE id = ?`, [
        ...values,
        id,
      ]);
    }
    if (people) await setCardAssignees(db, id, board.id, people);

    // A changed due date means the reminders should fire again — the same rule
    // the web app applies (server/api/data/card.ts), otherwise a card
    // rescheduled by an agent silently never reminds anyone again.
    if (dueDate !== undefined) {
      await db.execute(
        "UPDATE card_reminders SET notified = 0 WHERE card = ?",
        [id],
      );
    }

    // Done, and a repeating card: the next one goes on the board, and the card
    // read back below is the one that no longer repeats.
    const next =
      doneVal && !card.status ? await repeatCard(db, id, userId) : null;

    const [rows]: any = await db.execute("SELECT * FROM cards WHERE id = ?", [
      id,
    ]);
    const [updatedCard] = await attachAssignees(db, rows);

    // Notify collaborators when the done state actually changed.
    if (doneVal !== undefined && !!card.status !== !!doneVal) {
      const [invited]: any = await db.execute(
        "SELECT user FROM invitations WHERE board = ?",
        [board.id],
      );
      const usersToNotify = [
        board.user,
        ...invited.map((i: any) => i.user),
      ].filter(Boolean);
      const statusText = doneVal ? "completed" : "reopened";
      for (const notifyUserId of usersToNotify) {
        if (notifyUserId !== userId) {
          await db.execute(
            "INSERT INTO notifications (userId, type, boardId, cardId, message, actorId) VALUES (?, ?, ?, ?, ?, ?)",
            [
              notifyUserId,
              "card_status_changed",
              board.id,
              updatedCard.id,
              `Card "${updatedCard.name}" was ${statusText}`,
                            userId,
              ],
          );
        }
      }
    }

    const serverSocket = getServerSocket();
    if (serverSocket) {
      serverSocket.to(`board-${board.id}`).emit("updateCard", {
        boardId: board.id,
        attachments: [],
        card: { ...updatedCard, status: !!updatedCard.status },
      });
    }

    dispatchWebhooks({
      boardId: board.id,
      event: "card.updated",
      actorUserId: userId,
      card: serializeCard(updatedCard),
    });

    return jsonResult({
      card: serializeCard(updatedCard),
      ...(next ? { next: serializeCard(next) } : {}),
    });
  },
});
