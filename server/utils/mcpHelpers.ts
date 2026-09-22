import { z } from "zod";
import { setupDatabase } from "../../app/lib/databaseSetup";

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

// Resolve a board the caller can access at `level`, or throw. A board that
// exists but the caller can't see is reported as NOT_FOUND (same as missing) so
// ids can't be probed; a board the caller can read but not write is FORBIDDEN.
export async function requireBoard(
  boardId: number,
  userId: string,
  level: "read" | "edit",
) {
  const [rows]: any = await db.execute("SELECT * FROM boards WHERE id = ?", [
    boardId,
  ]);
  const board = rows[0];
  if (!board) throw new McpError("NOT_FOUND", `No board with id ${boardId}.`);
  const decision = await authorizeBoard(db, board, userId, level);
  if (!decision.ok) {
    if (decision.status === 404) {
      throw new McpError("NOT_FOUND", `No board with id ${boardId}.`);
    }
    throw new McpError(
      "FORBIDDEN",
      `You have read-only access to board ${boardId}; this action needs edit access.`,
    );
  }
  return board;
}

// Resolve a card (+ its board) the caller can access at `level`, or throw.
export async function requireCard(
  cardId: number,
  userId: string,
  level: "read" | "edit",
) {
  const [rows]: any = await db.execute(
    "SELECT c.*, a.board AS boardId FROM cards c JOIN areas a ON a.id = c.area WHERE c.id = ?",
    [cardId],
  );
  const card = rows[0];
  if (!card) throw new McpError("NOT_FOUND", `No card with id ${cardId}.`);
  const board = await requireBoard(card.boardId, userId, level);
  return { card, board };
}

// Resolve an area (+ its board) the caller can access at `level`, or throw.
export async function requireArea(
  areaId: number,
  userId: string,
  level: "read" | "edit",
) {
  const [rows]: any = await db.execute("SELECT * FROM areas WHERE id = ?", [
    areaId,
  ]);
  const area = rows[0];
  if (!area) throw new McpError("NOT_FOUND", `No area with id ${areaId}.`);
  const board = await requireBoard(area.board, userId, level);
  return { area, board };
}

// --- Serialization: one consistent shape per entity across every tool. ---

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
