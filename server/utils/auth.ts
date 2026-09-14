import { secureCookiesFor } from "./secureCookies";
import { setupDatabase } from "../../app/lib/databaseSetup";
import { v4 as uuidv4 } from "uuid";
import { setCookie, getCookie } from "h3";
import { resolveBoardAccess, type BoardAccess } from "./boardAccess";
import { hashApiKey } from "./apiKey";
import { logger } from "./logger";

// The id of a stored row, as it may arrive from a client. Two generations of
// them exist on an instance that has been running a while: the UUIDs this app
// has minted since v0.10.0, and the 32-character alphanumeric ids better-auth
// minted before it was replaced. Demanding a UUID — which four endpoints did
// from v0.19.0 — locked every account older than v0.10.0 out of being
// impersonated, edited or deleted. So this is a sanity check on the string
// only: the column is varchar(36), the query is parameterised, and whether the
// row exists is the lookup's answer to give, not this function's.
export const isStoredId = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 36 &&
  /^[A-Za-z0-9_-]+$/.test(value);

export async function createSession(
  event: any,
  userId: string,
  // When set (to an admin's user id), this session is an impersonation session:
  // the cookie authenticates as `userId` but the session records who started it
  // so the app can show a banner and offer a way back.
  impersonatedBy: string | null = null,
) {
  // Accept string or number, convert to string for backward compatibility
  const userIdStr = String(userId);

  // Validate userId is a non-empty string
  if (!userIdStr || typeof userIdStr !== "string") {
    logger.error("Invalid userId for session creation");
    return { error: "INVALID_USER_ID" };
  }

  try {
    const db = await setupDatabase();

    // Session lifetime is configurable via NUXT_SESSION_MAX_AGE_DAYS (defaults
    // to 1 day). Guard against a missing/invalid value.
    const configuredDays = Number(useRuntimeConfig(event).sessionMaxAgeDays);
    const sessionDays =
      Number.isFinite(configuredDays) && configuredDays > 0
        ? configuredDays
        : 1;
    const maxAgeSeconds = Math.floor(sessionDays * 24 * 60 * 60);

    // Generate session token
    const sessionToken = uuidv4();

    // Create session in database
    await db.execute(
      "INSERT INTO `session` (`id`, `expiresAt`, `token`, `userId`, `impersonatedBy`) VALUES (?, ?, ?, ?, ?)",
      [
        uuidv4(),
        new Date(Date.now() + maxAgeSeconds * 1000),
        sessionToken,
        userIdStr,
        impersonatedBy,
      ],
    );

    // Set session cookie. Secure when the instance is reached over HTTPS, which
    // is not the same as running in production — see secureCookies.ts.
    setCookie(event, "session_token", sessionToken, {
      httpOnly: true,
      secure: secureCookiesFor(event),
      sameSite: "lax",
      maxAge: maxAgeSeconds,
      path: "/",
    });

    return {
      sessionToken,
      user: {
        id: userIdStr,
      },
    };
  } catch (error) {
    logger.error("Session creation error:", error);
    return { error: "SESSION_CREATION_FAILED" };
  }
}

export async function verifyApiKey(apiKey: string) {
  // Validate API key input
  if (!apiKey || typeof apiKey !== "string" || apiKey.length > 64) {
    return { error: "INVALID_API_KEY" };
  }

  try {
    const db = await setupDatabase();

    // API keys are stored as a SHA-256 hash, so look up by the hash of the
    // presented key (a deterministic, indexed lookup). Any pre-hashing plaintext
    // keys were converted to hashes by the 0002 migration, so no plaintext
    // fallback is needed here.
    const hashedKey = hashApiKey(apiKey);
    const [keys] = await db.execute(
      "SELECT * FROM `apikey` WHERE `key` = ? AND (`enabled` IS NULL OR `enabled` = 1)",
      [hashedKey],
    );

    if (keys.length === 0) {
      return { error: "INVALID_API_KEY" };
    }

    const key = keys[0];

    // Reject expired keys.
    const isExpired = key.expiresAt && new Date(key.expiresAt) < new Date();
    if (isExpired) {
      return { error: "INVALID_API_KEY" };
    }

    return {
      key: {
        id: key.id,
        userId: key.referenceId, // referenceId stores the userId
        name: key.name,
        permissions: key.permissions ? JSON.parse(key.permissions) : null,
        metadata: key.metadata ? JSON.parse(key.metadata) : null,
      },
    };
  } catch (error) {
    logger.error("API key verification error:", error);
    return { error: "API_KEY_VERIFICATION_FAILED" };
  }
}

// Resolve the session + user directly from the database. Shared by the
// `/api/auth/get-session` endpoint and the internal `getUserSession` helper so there
// is a single implementation. The discriminated result lets the endpoint
// distinguish "no/invalid session" (401) from "banned" (403), while internal
// callers treat both as "not authenticated".
export type SessionResult =
  | { status: "ok"; session: any; user: any }
  | { status: "banned" }
  | { status: "invalid" };

export async function resolveSession(event: any): Promise<SessionResult> {
  // Token from the Authorization header (Bearer) or the session cookie.
  const sessionToken =
    event.headers.get("authorization")?.replace("Bearer ", "") ||
    getCookie(event, "session_token");

  return resolveSessionToken(sessionToken);
}

/**
 * Resolve a session straight from its token. Split out of `resolveSession` so
 * callers without an h3 event — notably the Socket.IO handshake, which only has
 * a raw cookie header — can authenticate through exactly the same path.
 */
export async function resolveSessionToken(
  sessionToken: any,
): Promise<SessionResult> {
  // Basic format validation.
  if (
    !sessionToken ||
    typeof sessionToken !== "string" ||
    sessionToken.length < 10
  ) {
    return { status: "invalid" };
  }

  const db = await setupDatabase();

  const [sessions]: any = await db.execute(
    "SELECT * FROM `session` WHERE `token` = ? AND `expiresAt` > NOW()",
    [sessionToken],
  );
  if (sessions.length === 0) {
    return { status: "invalid" };
  }
  const session = sessions[0];

  const [users]: any = await db.execute(
    "SELECT id, name, email, role, banned, banReason, image, banExpires, displayUsername, onboarded, type, emailNotifications FROM `user` WHERE `id` = ?",
    [session.userId],
  );
  if (users.length === 0) {
    return { status: "invalid" };
  }
  const user = users[0];

  // Don't leak ban details; banned users have no access.
  if (user.banned) {
    return { status: "banned" };
  }

  return {
    status: "ok",
    session: {
      id: session.id,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      // Non-null only while an admin is impersonating this user.
      impersonatedBy: session.impersonatedBy || null,
    },
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      image: user.image,
      displayUsername: user.displayUsername,
      onboarded: !!user.onboarded,
      type: user.type || "human",
      emailNotifications: !!user.emailNotifications,
    },
  };
}

export async function getUserSession(event: any) {
  try {
    // Resolve directly from the DB instead of doing an HTTP round-trip to
    // /api/auth/get-session on every authenticated request.
    const result = await resolveSession(event);
    if (result.status === "ok") {
      return { session: result.session, user: result.user };
    }
    return null;
  } catch (error) {
    logger.error("Session fetch error:", error);
    return null;
  }
}

export async function getApiKeyUser(event: any) {
  try {
    // `x-api-key` is the documented header, and `Authorization: Bearer <key>`
    // is accepted as the same thing — several MCP clients (Mistral's Le Chat,
    // the OpenAI Responses API) can only send a bearer token, so a key-only
    // server is simply unreachable from them. The bearer form is a fallback
    // rather than a first choice: callers that send both mean the explicit
    // header, and `Authorization` also carries session tokens elsewhere, which
    // the callers of this function resolve before they get here.
    const apiKey =
      event.headers.get("x-api-key") ||
      event.headers.get("authorization")?.replace(/^Bearer /i, "") ||
      null;

    if (!apiKey) {
      return null;
    }

    // Verify the API key
    const result = await verifyApiKey(apiKey);

    if (result.error) {
      logger.error("API key verification failed:", result.error);
      return null;
    }

    // Return user information from the API key, plus its permission scopes (or
    // null for an unrestricted key) so the MCP layer can gate write tools.
    return {
      user: {
        id: result.key.userId,
      },
      permissions: Array.isArray(result.key.permissions)
        ? result.key.permissions
        : null,
    };
  } catch (error) {
    logger.error("getApiKeyUser error:", error);
    return null;
  }
}

// A failed authorization check carries the HTTP status and a (deliberately
// generic) error message the caller should return verbatim.
export type AuthFailure = { ok: false; status: number; error: string };

const UNAUTHORIZED: AuthFailure = {
  ok: false,
  status: 403,
  error: "Unauthorized access",
};
// Returned when a user has NO access to a board that exists — deliberately the
// same 404 as a missing board, so an authenticated user can't tell whether a
// board id exists (existence oracle) by probing sequential ids.
const NOT_FOUND: AuthFailure = {
  ok: false,
  status: 404,
  error: "Resource not found",
};
const READ_ONLY_KEY: AuthFailure = {
  ok: false,
  status: 403,
  error: "This API key is read-only",
};

/**
 * Whether an API key may perform this request. `permissions` is the parsed
 * array stored with the key (e.g. ["read"]); null means an older key with no
 * scope recorded, which keeps full access so existing integrations don't break.
 */
export function apiKeyAllowsWrite(permissions: any, event: any): boolean {
  if (!Array.isArray(permissions)) return true;
  if (permissions.includes("write")) return true;
  const method = String(
    event?.method || event?.req?.method || "GET",
  ).toUpperCase();
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

export type UserResolution =
  AuthFailure | { ok: true; userId: string; viaApiKey: boolean };

/**
 * Resolve the authenticated user from either an `x-api-key` header or the
 * session cookie. This is the boilerplate every data endpoint used to repeat
 * inline. Returns the userId and whether it came from an API key (some
 * endpoints emit socket events only for API-key calls).
 */
export async function resolveUserId(event: any): Promise<UserResolution> {
  const apiKey = event.headers.get("x-api-key");

  let userIdFromApiKey: string | null = null;
  if (apiKey) {
    const data = await verifyApiKey(apiKey);
    if (data.error) return UNAUTHORIZED;

    // A read-only key must be read-only everywhere, not just over MCP. Enforce
    // it at the single choke point every data endpoint goes through, keyed on
    // the HTTP method: GET/HEAD read, everything else writes. Keys created
    // before permissions existed have `permissions === null` and stay
    // unrestricted.
    if (!apiKeyAllowsWrite(data.key.permissions, event)) return READ_ONLY_KEY;

    userIdFromApiKey = data.key.userId;
  }

  const session = await getUserSession(event);

  if (!userIdFromApiKey && !session) return UNAUTHORIZED;

  const userId = userIdFromApiKey || session?.user?.id;
  if (!userId) return UNAUTHORIZED;

  return { ok: true, userId: String(userId), viaApiKey: !!userIdFromApiKey };
}

export type AccessDecision =
  AuthFailure | { ok: true; access: Exclude<BoardAccess, "none"> };

/**
 * Decide access for an already-loaded board row. This is the reusable core for
 * endpoints that reach the board via a join (card → area → board) and therefore
 * don't have a boardId up front. It loads the user's invitation only when it can
 * matter and returns the exact status/message to return on denial.
 *
 * Access model: the owner always has edit; an invitation grants edit/read by its
 * permission; a public board is read-only to everyone else; a private board with
 * no invitation grants nothing. Public status never grants write.
 *
 * @param required  "read" allows owner/invited/public; "edit" requires the
 *                  owner or an `edit` invitation.
 */
export async function authorizeBoard(
  db: any,
  board: any,
  userId: string,
  required: "read" | "edit",
): Promise<AccessDecision> {
  const isOwner = !!userId && board.user === userId;

  // Load the invitation for non-owners only when it can affect the outcome:
  // for any "edit" check (an `edit` invitation is the only non-owner path to
  // write), and for private boards (where the invitation decides none/read/edit).
  // For a "read" check on a public board, read is granted regardless.
  let invitation = null;
  if (!isOwner) {
    const needInvitation = required === "edit" || board.status === "private";
    if (needInvitation) {
      const [invitationRows]: any = await db.execute(
        "SELECT permission FROM invitations WHERE board = ? AND user = ?",
        [board.id, userId],
      );
      invitation = invitationRows[0] || null;
    }
  }

  const access = resolveBoardAccess(board, userId, invitation);
  // No access at all → 404 (indistinguishable from a missing board). Has read
  // but "edit" was required → 403 (the user can already see the board, so this
  // leaks nothing new).
  if (access === "none") return NOT_FOUND;
  if (required === "edit" && access !== "edit") return UNAUTHORIZED;
  return { ok: true, access };
}

export type BoardAccessResolution =
  | AuthFailure
  | {
      ok: true;
      userId: string;
      viaApiKey: boolean;
      board: any;
      access: Exclude<BoardAccess, "none">;
    };

/**
 * Resolve the user, load the board by id, and decide access via
 * `authorizeBoard`. For endpoints that already have a boardId. Returns
 * `ok: false` with the exact status/message the endpoint should return.
 */
export async function requireBoardAccess(
  event: any,
  boardId: any,
  required: "read" | "edit",
): Promise<BoardAccessResolution> {
  // Validate the board id is a positive integer.
  if (!boardId || isNaN(Number(boardId)) || Number(boardId) <= 0) {
    return { ok: false, status: 400, error: "Invalid board ID" };
  }

  const auth = await resolveUserId(event);
  if (!auth.ok) return auth;

  const db = setupDatabase();

  const [rows]: any = await db.execute("SELECT * FROM boards WHERE id = ?", [
    boardId,
  ]);
  const board = rows[0];

  // Generic 404 to avoid board enumeration.
  if (!board) return { ok: false, status: 404, error: "Resource not found" };

  const decision = await authorizeBoard(db, board, auth.userId, required);
  if (!decision.ok) return decision;

  return {
    ok: true,
    userId: auth.userId,
    viaApiKey: auth.viaApiKey,
    board,
    access: decision.access,
  };
}
