import { defineEventHandler } from "h3";
import { SUPPORTED_SCOPES, issuer, resourceIdentifier } from "../../utils/oauth";

// RFC 9728. The MCP spec makes this one a MUST: it is how a client that got a
// 401 from `/mcp` finds out who issues tokens for it.
//
// Served at the bare well-known path and at the path-suffixed one
// (`/.well-known/oauth-protected-resource/mcp`), because a client deriving the
// URL from a resource with a path builds the second form, and a client that
// only knows the origin builds the first.
export default defineEventHandler(() => ({
  resource: resourceIdentifier(),
  authorization_servers: [issuer()],
  scopes_supported: SUPPORTED_SCOPES,
  bearer_methods_supported: ["header"],
  resource_documentation: `${issuer()}/api/`,
}));
