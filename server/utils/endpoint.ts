import { defineEventHandler, getQuery, setResponseStatus, type H3Event } from "h3";
import { setupDatabase } from "../../app/lib/databaseSetup";
import { areaAccess, boardAccess, cardAccess, type Level } from "./access";
import { getUserSession, resolveUserId, type AuthFailure } from "./auth";
import { logger } from "./logger";

// The frame every data endpoint shares. It answers a method the endpoint does
// not have with 405, a caller who is not signed in with their 401/403, and
// anything unexpected with a 500 — each as `{ error }`, the shape the API
// documentation promises — so an endpoint is only what it does:
//
//   export default dataHandler({
//     async GET({ query, cardOf }) {
//       const { card } = await cardOf(query.cardId, "read");
//       return { card };
//     },
//   });
//
// Inside, `fail(status, message)` answers with that status and stops, from as
// deep down as it is called.

class Refusal extends Error {
  constructor(
    public status: number,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** Answer with this status and `{ error: message }`, and stop here. */
export function fail(
  status: number,
  message: string,
  extra?: Record<string, unknown>,
): never {
  throw new Refusal(status, message, extra);
}

/** A positive whole number from a query or body, or a 400 with `message`. */
export function positiveId(value: unknown, message = "Invalid ID"): number {
  const id = Number(value);
  if (value === null || value === "" || !Number.isInteger(id) || id <= 0) {
    fail(400, message);
  }
  return id;
}

export interface Request {
  event: H3Event;
  db: any;
  userId: string;
  /** Whether the caller came with an API key rather than a browser session. */
  viaApiKey: boolean;
  query: Record<string, any>;
  /** The board, if the caller has `level` access to it; otherwise a 404 or 403. */
  boardOf: (id: unknown, level: Level) => Promise<{ board: any; access: Level }>;
  areaOf: (
    id: unknown,
    level: Level,
  ) => Promise<{ area: any; board: any; access: Level }>;
  cardOf: (
    id: unknown,
    level: Level,
  ) => Promise<{ card: any; area: any; board: any; access: Level }>;
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export function dataHandler(
  methods: Partial<Record<Method, (request: Request) => unknown>>,
) {
  return defineEventHandler(async (event) => {
    const handle = methods[event.method as Method];
    if (!handle) {
      setResponseStatus(event, 405);
      return { error: "Method not allowed" };
    }

    const auth = await resolveUserId(event);
    if (!auth.ok) {
      setResponseStatus(event, auth.status);
      return { error: auth.error };
    }

    const db = setupDatabase();
    const { userId } = auth;
    // The thing asked for, or the 404 or 403 the caller gets instead.
    const found = <T extends object>(result: AuthFailure | ({ ok: true } & T)): T => {
      if (!result.ok) fail(result.status, result.error);
      return result as T;
    };

    try {
      return await handle({
        event,
        db,
        userId,
        viaApiKey: auth.viaApiKey,
        query: getQuery(event),
        boardOf: async (id, level) =>
          found(await boardAccess(db, positiveId(id, "Invalid board ID"), userId, level)),
        areaOf: async (id, level) =>
          found(await areaAccess(db, positiveId(id, "Invalid area ID"), userId, level)),
        cardOf: async (id, level) =>
          found(await cardAccess(db, positiveId(id, "Invalid card ID"), userId, level)),
      });
    } catch (error: any) {
      if (error instanceof Refusal) {
        setResponseStatus(event, error.status);
        return { error: error.message, ...error.extra };
      }
      // h3's own refusals — a body that is not JSON, say — keep their status.
      if (error?.statusCode && error.statusCode < 500) {
        setResponseStatus(event, error.statusCode);
        return { error: error.statusMessage || error.message };
      }
      logger.error(`${event.method} ${event.path}:`, error);
      setResponseStatus(event, 500);
      return { error: "Internal server error" };
    }
  });
}

// The frame for the account endpoints under /api/auth and /api/oauth: one
// method; a signed-in session, or an administrator's, when `who` asks for one;
// and their own error codes — UNAUTHORIZED, FORBIDDEN, INTERNAL_SERVER_ERROR —
// rather than the data endpoints' sentences. `fail()` works here as well.
export function authHandler(
  method: Method,
  who: "anyone" | "user" | "admin",
  handle: (request: { event: H3Event; db: any; session: any }) => unknown,
) {
  return defineEventHandler(async (event) => {
    if (event.method !== method) {
      setResponseStatus(event, 405);
      return { error: "Method not allowed" };
    }
    let session: any = null;
    if (who !== "anyone") {
      session = await getUserSession(event);
      if (!session) {
        setResponseStatus(event, 401);
        return { error: "UNAUTHORIZED" };
      }
      if (who === "admin" && session.user.role !== "admin") {
        setResponseStatus(event, 403);
        return { error: "FORBIDDEN" };
      }
    }
    try {
      return await handle({ event, db: setupDatabase(), session });
    } catch (error) {
      if (error instanceof Refusal) {
        setResponseStatus(event, error.status);
        return { error: error.message, ...error.extra };
      }
      // Something the handler threw on purpose to answer a request — a
      // redirect, an h3 error with its own status — goes through as it is.
      if ((error as any)?.statusCode) throw error;
      logger.error(`${event.method} ${event.path}:`, error);
      setResponseStatus(event, 500);
      return { error: "INTERNAL_SERVER_ERROR" };
    }
  });
}
