import { defineEventHandler, readBody } from "h3";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { hashSecret, isUsableRedirect, newSecret } from "../../utils/oauth";

// Dynamic client registration (RFC 7591), kept for clients that only know this
// way of getting a client_id.
//
// The MCP spec now calls it deprecated and prefers Client ID Metadata
// Documents, which need no registration at all and no row here. This endpoint
// is the back-compatible path, and it is open — which is what the RFC intends
// for a public registration endpoint, and why what it hands out is worth
// nothing on its own: a client_id only becomes access when somebody signs in
// and agrees to it on the consent screen.
export default defineEventHandler(async (event) => {
  if (event.req.method !== "POST") {
    event.res.statusCode = 405;
    return { error: "invalid_request", error_description: "Method not allowed" };
  }

  const body: any = (await readBody(event).catch(() => null)) ?? {};
  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.map(String).filter(isUsableRedirect)
    : [];

  if (!redirectUris.length) {
    event.res.statusCode = 400;
    return {
      error: "invalid_redirect_uri",
      error_description: "At least one usable redirect URI is required.",
    };
  }

  const method =
    body.token_endpoint_auth_method === "client_secret_post"
      ? "client_secret_post"
      : "none";
  const clientId = `lb_${newSecret().slice(0, 32)}`;
  const secret = method === "client_secret_post" ? newSecret() : null;

  const db = setupDatabase();
  await db.execute(
    "INSERT INTO `oauth_clients` (`id`, `name`, `redirectUris`, `tokenEndpointAuthMethod`, `registration`, `uri`, `logoUri`, `secretHash`) " +
      "VALUES (?, ?, ?, ?, 'dynamic', ?, ?, ?)",
    [
      clientId,
      String(body.client_name || "Unnamed client").slice(0, 255),
      JSON.stringify(redirectUris),
      method,
      body.client_uri ? String(body.client_uri).slice(0, 512) : null,
      body.logo_uri ? String(body.logo_uri).slice(0, 512) : null,
      secret ? hashSecret(secret) : null,
    ],
  );

  event.res.statusCode = 201;
  return {
    client_id: clientId,
    ...(secret ? { client_secret: secret } : {}),
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: redirectUris,
    token_endpoint_auth_method: method,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    client_name: String(body.client_name || "Unnamed client").slice(0, 255),
  };
});
