import { defineEventHandler, setHeader, setResponseStatus } from "h3";
import {
  SCOPE_READ,
  SCOPE_WRITE,
  issuer,
  validateAccessToken,
} from "../utils/oauth";
import { getApiKeyUser } from "../utils/auth";

// `/mcp` as an OAuth resource server.
//
// The MCP authorization spec turns an unauthenticated request into the start of
// a conversation: the server answers 401 with a `WWW-Authenticate` header
// naming its protected-resource metadata, the client reads that, finds the
// authorization server, and comes back with a token. Without the header there
// is nothing to discover and a client like ChatGPT simply reports that it
// cannot connect.
//
// This runs before the MCP handler so the challenge can be sent at all — the
// handler's own middleware has no way to refuse a request. API keys still work
// exactly as they did; they are tried first when sent in their own header.

const CHALLENGE_SCOPE = `${SCOPE_READ} ${SCOPE_WRITE}`;

const isMcpRequest = (path: string) =>
  path === "/mcp" || path.startsWith("/mcp/") || path.startsWith("/mcp?");

export default defineEventHandler(async (event) => {
  const path = event.path || "";
  if (!isMcpRequest(path)) return;

  const bearer = event.headers.get("authorization")?.replace(/^Bearer /i, "");
  const hasKeyHeader = !!event.headers.get("x-api-key");

  // An OAuth access token arrives in the same header an API key may use, so the
  // order matters only to keep the logs honest: a token tried as a key fails
  // loudly, and the common case should not look like an error.
  if (!hasKeyHeader && bearer) {
    const token = await validateAccessToken(bearer);
    if (token) {
      event.context.user = { id: token.userId };
      event.context.userId = token.userId;
      event.context.apiKeyPermissions = token.permissions;
      event.context.oauthClientId = token.clientId;
      return;
    }
  }

  const key = await getApiKeyUser(event);
  if (key) {
    event.context.user = key.user;
    event.context.userId = key.user.id;
    event.context.apiKeyPermissions = key.permissions ?? null;
    return;
  }

  // Nothing usable. Returning a body from a Nitro middleware ends the request,
  // which is what sends the challenge instead of the MCP handler's own answer.
  setResponseStatus(event, 401);
  setHeader(
    event,
    "WWW-Authenticate",
    `Bearer resource_metadata="${issuer()}/.well-known/oauth-protected-resource", scope="${CHALLENGE_SCOPE}"`,
  );
  return {
    error: "unauthorized",
    error_description:
      "Send an API key in x-api-key, or an OAuth access token as a bearer token. See the resource metadata named in WWW-Authenticate.",
  };
});
