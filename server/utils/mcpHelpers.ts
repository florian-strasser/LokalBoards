import { z } from "zod";
import { setupDatabase } from "../../app/lib/databaseSetup";
import { areaAccess, boardAccess, cardAccess, type Level } from "./access";
import { boardMemberIds } from "./cardAssignees";
import type { AuthFailure } from "./auth";

// Shared helpers for the MCP tools: authentication, scoped board access, stable
// structured errors and consistent serialization. Tools throw `McpError` on
// failure — the toolkit converts thrown errors into MCP `isError` results, so
// the agent sees a machine-parseable `CODE: message`.

const db = setupDatabase();

export type McpErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "INTERNAL";

export class McpError extends Error {
  constructor(
    public code: McpErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "McpError";
  }
}

// The authenticated caller's user id (set by the MCP middleware from the API
// key). Throws UNAUTHORIZED when the key is missing or invalid.
export function requireUserId(): string {
  const event = useEvent();
  const userId = event.context?.userId as string | undefined;
  if (!userId) {
    throw new McpError(
      "UNAUTHORIZED",
      "Missing or invalid API key. Send it in the `x-api-key` header, or as `Authorization: Bearer <key>`. Create one under Settings → API keys.",
    );
  }
  return userId;
}

// A mutating tool: reject read-only API keys (keys whose permission scopes don't
// include "write"). An unrestricted key (no scopes) is allowed.
export function requireWriteAccess(): void {
  const event = useEvent();
  const perms = event.context?.apiKeyPermissions as string[] | null | undefined;
  if (Array.isArray(perms) && !perms.includes("write")) {
    throw new McpError(
      "FORBIDDEN",
      "This API key is read-only; it can't create, update, move or delete.",
    );
  }
}

// Reusable input fields. Each id accepts the standard camelCase name plus its
// legacy `*ID` spelling (deprecated alias) so older integrations keep working;
// tools coalesce them with `requireId`.
export const boardIdInput = {
  boardId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("The board id (from listBoards)."),
  boardID: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Deprecated alias for boardId."),
};
export const areaIdInput = {
  areaId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("The area id (from listAreas or getBoardTree)."),
  areaID: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Deprecated alias for areaId."),
};
export const cardIdInput = {
  cardId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("The card id (from listCards, searchCards or getBoardTree)."),
  cardID: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Deprecated alias for cardId."),
};

// Coalesce a preferred parameter with a deprecated alias (e.g. `cardId` /
// `cardID`) and require one of them.
export function requireId(
  preferred: number | undefined,
  alias: number | undefined,
  name: string,
): number {
  const id = preferred ?? alias;
  if (id == null || Number.isNaN(Number(id))) {
    throw new McpError("VALIDATION", `${name} is required.`);
  }
  return Number(id);
}

// The board, area or card the caller can access at `level`, decided the same
// way the REST API decides it (see access.ts), or thrown as the error an agent
// reads: what is not there and what the caller may not see are both NOT_FOUND,
// so ids can't be probed; what the caller can read but not change is FORBIDDEN.
//
// What is in the archive — a card, or the area or board it is in — is not
// there for an agent either. In the app it is off the board: nobody changes,
// moves or comments on it until it is restored, and neither does an agent that
// happens to know its id.
function refuse(result: AuthFailure, kind: string, id: number): never {
  if (result.status === 404) missing(kind, id);
  throw new McpError(
    "FORBIDDEN",
    `You have read-only access to this ${kind}'s board; this action needs edit access.`,
  );
}

function missing(kind: string, id: number): never {
  throw new McpError("NOT_FOUND", `No ${kind} with id ${id}.`);
}

export async function requireBoard(
  boardId: number,
  userId: string,
  level: Level,
) {
  const found = await boardAccess(db, boardId, userId, level);
  if (!found.ok) refuse(found, "board", boardId);
  if (found.board.archivedAt) missing("board", boardId);
  return found.board;
}

export async function requireArea(
  areaId: number,
  userId: string,
  level: Level,
) {
  const found = await areaAccess(db, areaId, userId, level);
  if (!found.ok) refuse(found, "area", areaId);
  if (found.area.archivedAt || found.board.archivedAt) missing("area", areaId);
  return { area: found.area, board: found.board };
}

export async function requireCard(
  cardId: number,
  userId: string,
  level: Level,
) {
  const found = await cardAccess(db, cardId, userId, level);
  if (!found.ok) refuse(found, "card", cardId);
  if (found.card.archivedAt || found.area.archivedAt || found.board.archivedAt) {
    missing("card", cardId);
  }
  return {
    card: { ...found.card, boardId: found.board.id },
    area: found.area,
    board: found.board,
  };
}

// The people on a card can only be people on its board.
export async function requireMembers(boardId: number, people: string[]) {
  const members = await boardMemberIds(db, boardId);
  const stranger = people.find((person) => !members.has(person));
  if (stranger) {
    throw new McpError(
      "VALIDATION",
      `'${stranger}' is not a member of this board (see listBoardMembers).`,
    );
  }
}

// A due date as an agent sends it: an ISO 8601 date, '' for none, or left out.
export function dueDateFrom(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === "" || value === null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new McpError("VALIDATION", "dueDate must be an ISO 8601 date or ''.");
  }
  return date;
}

// --- Serialization: one consistent shape per entity across every tool. ---

export function serializeComment(comment: any) {
  return {
    id: comment.id,
    cardId: comment.card,
    authorId: comment.user ?? null,
    authorName: comment.userName,
    content: comment.content ?? "",
    date: comment.date ? new Date(comment.date).toISOString() : null,
  };
}

export function serializeBoard(board: any) {
  return {
    id: board.id,
    name: board.name,
    style: board.style || "kanban",
    status: board.status || "private",
    // The tile's appearance. Both are settable through createBoard and
    // updateBoard, so both are readable here — otherwise a client could only
    // ever write them and never see what a board currently looks like.
    image: board.image || null,
    color: board.color || null,
    ownerId: board.user,
  };
}

export function serializeArea(area: any) {
  return {
    id: area.id,
    boardId: area.board,
    name: area.name,
    position: area.sort ?? 0,
  };
}

export function serializeCard(card: any) {
  // Everyone on the card, when the caller has attached them (see
  // `attachAssignees`); `assigneeId` is the first of them, which is what it
  // meant before a card could be on more than one person.
  const assigneeIds: string[] = Array.isArray(card.assignees)
    ? card.assignees.map((person: any) => person.id)
    : card.assignee
      ? [card.assignee]
      : [];
  return {
    id: card.id,
    areaId: card.area,
    name: card.name,
    // Markdown.
    content: card.content ?? "",
    done: !!card.status,
    dueDate: card.dueDate ? new Date(card.dueDate).toISOString() : null,
    assigneeIds,
    assigneeId: assigneeIds[0] ?? null,
    // How it repeats once done, or null. See `server/utils/repeat.ts`.
    repeat: card.repeatEvery ?? null,
    position: card.sort ?? 0,
    ...(card.commentCount != null ? { commentCount: card.commentCount } : {}),
    ...(card.attachmentCount != null
      ? { attachmentCount: card.attachmentCount }
      : {}),
  };
}
