import { readBody, setHeader } from "h3";
import { hashToken } from "../../utils/auth";
import { safeEqual } from "../../utils/sso";
import {
  issueTokens,
  resolveClient,
  resourceMatches,
  verifyPkce,
} from "../../utils/oauth";

// The token endpoint: an authorization code or a refresh token in, an access
// token out.
//
// Client authentication is `none` — these are public clients holding no secret,
// which is what ChatGPT and every other MCP client in practice is, and what
// PKCE exists to make safe. A client that registered with a secret may send it,
// and then it is checked.

// An OAuth error: the code the client acts on, and a sentence for its logs.
const oauthError = (event: any, error: string, description?: string, status = 400) => {
  event.res.statusCode = status;
  return { error, ...(description ? { error_description: description } : {}) };
};

export default authHandler("POST", "anyone", async ({ event, db }) => {
  // Token responses must never be cached: they carry credentials.
  setHeader(event, "cache-control", "no-store");
  setHeader(event, "pragma", "no-cache");

  const body: any = (await readBody(event).catch(() => null)) ?? {};
  const grantType = String(body.grant_type || "");

  const client = await resolveClient(body.client_id);
  if (!client) return oauthError(event, "invalid_client", "Unknown client.", 401);

  // A client that has a secret must prove it; one registered without stays a
  // public client and is held up by PKCE instead.
  if (client.tokenEndpointAuthMethod === "client_secret_post") {
    const [rows]: any = await db.execute(
      "SELECT `secretHash` FROM `oauth_clients` WHERE `id` = ?",
      [client.id],
    );
    const expected = rows[0]?.secretHash;
    const given = body.client_secret ? hashToken(String(body.client_secret)) : "";
    if (!expected || !given || !safeEqual(expected, given)) {
      return oauthError(event, "invalid_client", "Client authentication failed.", 401);
    }
  }

  if (grantType === "authorization_code") {
    const code = String(body.code || "");
    if (!code) return oauthError(event, "invalid_request", "A code is required.");

    const codeHash = hashToken(code);
    const [rows]: any = await db.execute(
      "SELECT * FROM `oauth_codes` WHERE `codeHash` = ? LIMIT 1",
      [codeHash],
    );
    const record = rows[0];
    if (!record) return oauthError(event, "invalid_grant", "That code is not valid.");

    // A code offered twice means either a client bug or somebody replaying a
    // stolen one. There is no way to tell them apart, so the safe reading wins:
    // everything that code ever produced is revoked.
    if (record.usedAt) {
      await db.execute(
        "UPDATE `oauth_tokens` SET `revokedAt` = NOW() WHERE `clientId` = ? AND `userId` = ? AND `revokedAt` IS NULL",
        [record.clientId, record.userId],
      );
      return oauthError(event, "invalid_grant", "That code has already been used.");
    }

    await db.execute("UPDATE `oauth_codes` SET `usedAt` = NOW() WHERE `codeHash` = ?", [
      codeHash,
    ]);

    if (new Date(record.expiresAt).getTime() < Date.now()) {
      return oauthError(event, "invalid_grant", "That code has expired.");
    }
    if (record.clientId !== client.id) {
      return oauthError(event, "invalid_grant", "That code was issued to another client.");
    }
    // The redirect URI is part of what the code was bound to, and has to match.
    if (String(body.redirect_uri || "") !== record.redirectUri) {
      return oauthError(event, "invalid_grant", "The redirect URI does not match the one the code was issued for.");
    }
    if (!verifyPkce(String(body.code_verifier || ""), record.codeChallenge)) {
      return oauthError(event, "invalid_grant", "The PKCE verifier does not match.");
    }
    if (!resourceMatches(body.resource)) {
      return oauthError(event, "invalid_target", "Tokens from this server are only valid for its own MCP endpoint.");
    }

    return await issueTokens(
      client.id,
      record.userId,
      record.scope,
      record.resource ?? (body.resource ? String(body.resource) : null),
    );
  }

  if (grantType === "refresh_token") {
    const refresh = String(body.refresh_token || "");
    if (!refresh) return oauthError(event, "invalid_request", "A refresh token is required.");

    const [rows]: any = await db.execute(
      "SELECT * FROM `oauth_tokens` WHERE `refreshHash` = ? LIMIT 1",
      [hashToken(refresh)],
    );
    const record = rows[0];
    if (!record) return oauthError(event, "invalid_grant", "That refresh token is not valid.");
    if (record.clientId !== client.id) {
      return oauthError(event, "invalid_grant", "That refresh token belongs to another client.");
    }
    if (record.revokedAt) {
      return oauthError(event, "invalid_grant", "That refresh token has been revoked.");
    }
    if (
      record.refreshExpiresAt &&
      new Date(record.refreshExpiresAt).getTime() < Date.now()
    ) {
      return oauthError(event, "invalid_grant", "That refresh token has expired.");
    }

    // Rotation: the old pair dies as the new one is born, so a refresh token
    // that leaks is good for one use and its use is visible.
    await db.execute("UPDATE `oauth_tokens` SET `revokedAt` = NOW() WHERE `id` = ?", [
      record.id,
    ]);

    // A refresh may ask for less than it holds, never for more.
    const held = String(record.scope).split(/\s+/).filter(Boolean);
    const asked = String(body.scope || "").split(/\s+/).filter(Boolean);
    const scope = asked.length
      ? asked.filter((s) => held.includes(s)).join(" ") || record.scope
      : record.scope;

    return await issueTokens(client.id, record.userId, scope, record.resource);
  }

  return oauthError(
    event,
    "unsupported_grant_type",
    "This server supports authorization_code and refresh_token.",
  );
});
