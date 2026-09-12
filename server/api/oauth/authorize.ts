import { defineEventHandler, getQuery, readBody } from "h3";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import {
  CODE_LIFETIME_SECONDS,
  SCOPE_WRITE,
  hashSecret,
  issuer,
  newSecret,
  normalizeScope,
  redirectAllowed,
  resolveClient,
  resourceMatches,
} from "../../utils/oauth";

// The authorization endpoint, in two halves.
//
// GET describes the request: is this a client we can place, is it asking for
// somewhere we would send somebody, and what is it asking for. The page at
// /oauth/authorize renders that description as a consent screen.
//
// POST is the answer. Allow mints a one-minute authorization code; deny sends
// the client away with an error. Either way the reply is a URL for the browser
// to go to, rather than a redirect from here — the decision is made by a fetch
// from the page, and a 302 in a fetch response goes nowhere useful.
//
// Which errors may be redirected is not a style choice. Until the client and
// its redirect URI are both known-good, an error must be shown to the person
// rather than sent onwards: redirecting to an unverified address is how an
// open redirector is built.

interface Checked {
  ok: true;
  client: any;
  redirectUri: string;
  scope: string;
  state: string | null;
  codeChallenge: string;
  resource: string | null;
}
interface Failed {
  ok: false;
  status: number;
  error: string;
  description: string;
  redirectable: boolean;
  redirectUri?: string;
  state?: string | null;
}

async function check(query: any): Promise<Checked | Failed> {
  const fail = (
    error: string,
    description: string,
    extra: Partial<Failed> = {},
  ): Failed => ({
    ok: false,
    status: 400,
    error,
    description,
    redirectable: false,
    ...extra,
  });

  const client = await resolveClient(query.client_id);
  if (!client) {
    return fail(
      "invalid_client",
      "That application could not be identified. Its client_id must be a reachable HTTPS metadata document, or a client registered here.",
    );
  }

  const redirectUri = String(query.redirect_uri || "");
  if (!redirectAllowed(client, redirectUri)) {
    return fail(
      "invalid_request",
      "That application asked to be sent somewhere it has not declared as one of its redirect URIs.",
    );
  }

  // Past this line the redirect URI is the client's own, so errors go back to
  // it the way the spec says they should.
  const state = query.state === undefined ? null : String(query.state);
  const redirectable = { redirectable: true, redirectUri, state };

  if (String(query.response_type || "") !== "code") {
    return fail(
      "unsupported_response_type",
      "This server issues authorization codes only.",
      redirectable,
    );
  }

  const codeChallenge = String(query.code_challenge || "");
  const method = String(query.code_challenge_method || "");
  if (!codeChallenge || method !== "S256") {
    return fail(
      "invalid_request",
      "PKCE with S256 is required.",
      redirectable,
    );
  }

  if (!resourceMatches(query.resource)) {
    return fail(
      "invalid_target",
      "Tokens from this server are only valid for its own MCP endpoint.",
      redirectable,
    );
  }

  return {
    ok: true,
    client,
    redirectUri,
    scope: normalizeScope(query.scope),
    state,
    codeChallenge,
    resource: query.resource ? String(query.resource) : null,
  };
}

/** Build the URL to send the browser to, with `iss` per RFC 9207. */
function redirectWith(
  redirectUri: string,
  params: Record<string, string | null | undefined>,
): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) url.searchParams.set(key, value);
  }
  url.searchParams.set("iss", issuer());
  return url.toString();
}

export default defineEventHandler(async (event) => {
  const method = event.req.method;

  if (method === "GET") {
    const checked = await check(getQuery(event));
    if (!checked.ok) {
      event.res.statusCode = checked.status;
      return {
        error: checked.error,
        error_description: checked.description,
        // The page needs to know whether it may offer to send the person back.
        redirect: checked.redirectable
          ? redirectWith(checked.redirectUri!, {
              error: checked.error,
              error_description: checked.description,
              state: checked.state,
            })
          : null,
      };
    }

    // Who is being asked. Not being signed in is not an error here — the page
    // sends them to sign in and brings them back.
    const session = await resolveSession(event);
    const user = session.status === "ok" ? session.user : null;

    // Something they have already agreed to, asking for no more than last time,
    // does not ask again.
    let alreadyAgreed = false;
    if (user) {
      const db = setupDatabase();
      const [rows]: any = await db.execute(
        "SELECT `scope` FROM `oauth_consents` WHERE `userId` = ? AND `clientId` = ?",
        [user.id, checked.client.id],
      );
      const granted = String(rows[0]?.scope || "").split(/\s+/).filter(Boolean);
      alreadyAgreed = checked.scope
        .split(/\s+/)
        .every((scope) => granted.includes(scope));
    }

    return {
      client: {
        id: checked.client.id,
        name: checked.client.name,
        uri: checked.client.uri,
        registration: checked.client.registration,
      },
      scope: checked.scope,
      writes: checked.scope.includes(SCOPE_WRITE),
      account: user ? { name: user.name, email: user.email } : null,
      alreadyAgreed,
    };
  }

  if (method === "POST") {
    const body = await readBody(event).catch(() => ({}));
    const checked = await check(body ?? {});
    if (!checked.ok) {
      event.res.statusCode = checked.status;
      return { error: checked.error, error_description: checked.description };
    }

    const session = await resolveSession(event);
    if (session.status !== "ok") {
      event.res.statusCode = 401;
      return { error: "login_required" };
    }
    const user = session.user;

    if (!(body as any)?.approve) {
      return {
        redirect: redirectWith(checked.redirectUri, {
          error: "access_denied",
          error_description: "The request was declined.",
          state: checked.state,
        }),
      };
    }

    // What was asked for, narrowed by what was agreed to. Never widened: the
    // consent screen can only take permissions away from the request.
    const granted = (body as any)?.readOnly
      ? checked.scope
          .split(/\s+/)
          .filter((scope) => scope !== SCOPE_WRITE)
          .join(" ")
      : checked.scope;

    const db = setupDatabase();
    const code = newSecret();
    await db.execute(
      "INSERT INTO `oauth_codes` (`codeHash`, `clientId`, `userId`, `redirectUri`, `scope`, `codeChallenge`, `resource`, `expiresAt`) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))",
      [
        hashSecret(code),
        checked.client.id,
        user.id,
        checked.redirectUri,
        granted,
        checked.codeChallenge,
        checked.resource,
        CODE_LIFETIME_SECONDS,
      ],
    );

    // Remembered so the next connection from the same client for the same
    // scopes is one click instead of two.
    await db.execute(
      "INSERT INTO `oauth_consents` (`userId`, `clientId`, `scope`) VALUES (?, ?, ?) " +
        "ON DUPLICATE KEY UPDATE `scope` = VALUES(`scope`), `createdAt` = NOW()",
      [user.id, checked.client.id, granted],
    );

    return {
      redirect: redirectWith(checked.redirectUri, {
        code,
        state: checked.state,
      }),
    };
  }

  event.res.statusCode = 405;
  return { error: "invalid_request", error_description: "Method not allowed" };
});
