import { defineEventHandler } from "h3";
import { SUPPORTED_SCOPES, issuer } from "../../utils/oauth";

// RFC 8414. The spec requires at least one discovery document; this is the one
// an MCP client tries first.
//
// What it advertises is deliberately narrow: one grant type plus refresh, one
// response type, PKCE with S256 only. OAuth 2.1 removes the implicit and
// password grants, and there is no reason for this server to offer more than
// the single flow it exists to support.
export default defineEventHandler(() => {
  const origin = issuer();
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    revocation_endpoint: `${origin}/api/oauth/revoke`,
    scopes_supported: SUPPORTED_SCOPES,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    // RFC 9207: the authorization response carries `iss`, and saying so here is
    // what lets a client insist on it.
    authorization_response_iss_parameter_supported: true,
    // Client ID Metadata Documents — the registration path the spec now
    // prefers and ChatGPT leads with. `/api/oauth/register` stays for clients
    // that only know the deprecated one.
    client_id_metadata_document_supported: true,
    service_documentation: `${origin}/docs/mcp-server`,
  };
});
