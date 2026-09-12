import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { setupDatabase } from "../../app/lib/databaseSetup";

// LokalBoards as an OAuth 2.1 authorization server and resource server, which
// is what the MCP authorization spec asks for and what ChatGPT requires.
//
// Everything here serves one endpoint: `/mcp`. There is no general-purpose
// OAuth surface, no third-party API for arbitrary apps — the tokens this issues
// are good for the MCP server and nothing else, and they say so.
//
// The two scopes map onto the permission model API keys already use, rather
// than inventing a second one. A key's `permissions` is a JSON array where
// "write" means full; the MCP tools already gate on it, so a token that sets
// the same array needs no changes anywhere else.

export const SCOPE_READ = "boards:read";
export const SCOPE_WRITE = "boards:write";
export const SUPPORTED_SCOPES = [SCOPE_READ, SCOPE_WRITE];

// Ten minutes of access, thirty days of refresh. Short access tokens are what
// make a stolen one survivable; the refresh token is the thing kept safe.
const ACCESS_TTL_SECONDS = 60 * 60;
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;
const CODE_TTL_SECONDS = 60;

/** The permissions array a token's scope grants, in the API key's own shape. */
export function scopeToPermissions(scope: string): string[] {
  const scopes = String(scope || "").split(/\s+/).filter(Boolean);
  return scopes.includes(SCOPE_WRITE) ? ["read", "write"] : ["read"];
}

/** Only scopes this server knows, in a stable order, never empty. */
export function normalizeScope(requested: unknown): string {
  const asked = String(requested || "")
    .split(/\s+/)
    .filter((scope) => SUPPORTED_SCOPES.includes(scope));
  if (asked.includes(SCOPE_WRITE)) return `${SCOPE_READ} ${SCOPE_WRITE}`;
  return SCOPE_READ;
}

/**
 * This instance's public origin, without a trailing slash.
 *
 * Everything OAuth says about itself has to be an absolute URL that a client on
 * the other side of the internet can fetch, so it comes from the configured
 * public address rather than from the request.
 */
export function issuer(): string {
  const configured =
    process.env.NUXT_BOARDS_URL || useRuntimeConfig().boardsUrl || "";
  return String(configured).replace(/\/+$/, "");
}

/**
 * The canonical URI of the thing tokens are for: the MCP endpoint.
 *
 * RFC 8707 calls this the resource indicator, and the spec is specific about
 * the form — no fragment, no trailing slash.
 */
export function resourceIdentifier(): string {
  return `${issuer()}/mcp`;
}

/** A resource parameter the client sent, checked against what we serve. */
export function resourceMatches(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  const wanted = String(value).replace(/\/+$/, "").toLowerCase();
  const ours = resourceIdentifier().toLowerCase();
  // `https://host` is accepted alongside `https://host/mcp`: a client that
  // names the server rather than the endpoint means the same thing, and the
  // spec asks only for the most specific URI the client can give.
  return wanted === ours || wanted === issuer().toLowerCase();
}

// Tokens are random, not signed: this server is the only thing that validates
// them, so a database lookup is simpler than key management and makes
// revocation immediate rather than eventual.
export const newSecret = () => randomBytes(32).toString("hex");
export const hashSecret = (value: string) =>
  createHash("sha256").update(String(value)).digest("hex");

/** Constant-time compare for anything secret-shaped. */
export function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** PKCE, S256 only — OAuth 2.1 does not allow `plain`. */
export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) return false;
  if (verifier.length < 43 || verifier.length > 128) return false;
  const computed = createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return secretsMatch(computed, challenge);
}

export interface OAuthClient {
  id: string;
  name: string;
  redirectUris: string[];
  tokenEndpointAuthMethod: string;
  registration: string;
  uri?: string | null;
  logoUri?: string | null;
}

const MAX_METADATA_BYTES = 64 * 1024;

/**
 * A Client ID Metadata Document: the client_id is itself an HTTPS URL that
 * serves the client's metadata, and the document is fetched from it.
 *
 * This is what the spec now prefers and what ChatGPT leads with. It means no
 * registration step and no stored secret — the client's identity is a URL whose
 * content its own operator controls, and the document must claim the same URL
 * as its `client_id` so that one client cannot publish another's identity.
 */
async function fetchClientMetadata(clientId: string): Promise<OAuthClient | null> {
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return null;
  }
  // HTTPS only, and nothing with credentials or a fragment in it.
  //
  // The escape hatch is for development and for the test suite: a metadata
  // document has to be served from somewhere, and a loopback address cannot
  // easily serve HTTPS. It is off unless deliberately set, and it only ever
  // relaxes the scheme for loopback — a client_id pointing anywhere else still
  // has to be HTTPS.
  const loopback = ["127.0.0.1", "localhost", "[::1]", "::1"].includes(
    url.hostname,
  );
  const insecureAllowed =
    process.env.NUXT_OAUTH_ALLOW_INSECURE_CLIENT_METADATA === "true" && loopback;
  if (url.username || url.password || url.hash) return null;
  if (url.protocol !== "https:" && !(url.protocol === "http:" && insecureAllowed)) {
    return null;
  }

  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;

    const text = (await response.text()).slice(0, MAX_METADATA_BYTES);
    const metadata = JSON.parse(text);

    // The document must name itself. Without this check anybody could hand us
    // somebody else's client_id and have us trust a document they control.
    if (String(metadata.client_id) !== clientId) return null;

    const redirectUris = Array.isArray(metadata.redirect_uris)
      ? metadata.redirect_uris.map(String).filter(isUsableRedirect)
      : [];
    if (!redirectUris.length) return null;

    return {
      id: clientId,
      name: String(metadata.client_name || url.hostname).slice(0, 255),
      redirectUris,
      tokenEndpointAuthMethod: String(
        metadata.token_endpoint_auth_method || "none",
      ),
      registration: "cimd",
      uri: metadata.client_uri ? String(metadata.client_uri).slice(0, 512) : null,
      logoUri: metadata.logo_uri ? String(metadata.logo_uri).slice(0, 512) : null,
    };
  } catch (error) {
    logger.error("Could not read the client's metadata document:", error);
    return null;
  }
}

/**
 * A redirect target we are willing to send somebody to. HTTPS anywhere, plus
 * loopback HTTP, which is how a desktop client receives its callback.
 */
export function isUsableRedirect(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;

    // Plain HTTP only to the machine the client is running on. Anywhere else it
    // would carry the authorization code across the network in the clear, which
    // is why OAuth 2.1 allows the loopback exception and nothing wider.
    if (url.protocol === "http:") {
      return ["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname);
    }

    // A private-use scheme is how a native app receives its callback. It has no
    // host to check, so it is taken as given — except for the three that would
    // turn a redirect into code execution or a file read.
    return !["javascript:", "data:", "file:"].includes(url.protocol);
  } catch {
    return false;
  }
}

/**
 * The client behind a `client_id`, from its metadata document if the id is a
 * URL, and from the register otherwise. A CIMD client is remembered so the
 * consent screen and *Connected apps* have a name to show without fetching.
 */
export async function resolveClient(clientId: unknown): Promise<OAuthClient | null> {
  const id = String(clientId || "");
  if (!id || id.length > 255) return null;

  if (/^https?:\/\//i.test(id)) {
    const fetched = await fetchClientMetadata(id);
    if (!fetched) return null;
    await rememberClient(fetched);
    return fetched;
  }

  const db = setupDatabase();
  const [rows]: any = await db.execute(
    "SELECT * FROM `oauth_clients` WHERE `id` = ?",
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    redirectUris: JSON.parse(row.redirectUris || "[]"),
    tokenEndpointAuthMethod: row.tokenEndpointAuthMethod,
    registration: row.registration,
    uri: row.uri,
    logoUri: row.logoUri,
  };
}

export async function rememberClient(client: OAuthClient): Promise<void> {
  const db = setupDatabase();
  await db.execute(
    "INSERT INTO `oauth_clients` (`id`, `name`, `redirectUris`, `tokenEndpointAuthMethod`, `registration`, `uri`, `logoUri`, `refreshedAt`) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, NOW()) " +
      "ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `redirectUris` = VALUES(`redirectUris`), " +
      "`tokenEndpointAuthMethod` = VALUES(`tokenEndpointAuthMethod`), `uri` = VALUES(`uri`), " +
      "`logoUri` = VALUES(`logoUri`), `refreshedAt` = NOW()",
    [
      client.id,
      client.name,
      JSON.stringify(client.redirectUris),
      client.tokenEndpointAuthMethod,
      client.registration,
      client.uri ?? null,
      client.logoUri ?? null,
    ],
  );
}

/** Exact string match, as OAuth 2.1 requires — no prefix or wildcard matching. */
export function redirectAllowed(client: OAuthClient, redirectUri: unknown): boolean {
  const wanted = String(redirectUri || "");
  return !!wanted && client.redirectUris.includes(wanted);
}

export interface IssuedTokens {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

/** Mint an access/refresh pair for a client acting for a user. */
export async function issueTokens(
  clientId: string,
  userId: string,
  scope: string,
  resource: string | null,
): Promise<IssuedTokens> {
  const db = setupDatabase();
  const access = newSecret();
  const refresh = newSecret();

  await db.execute(
    "INSERT INTO `oauth_tokens` (`accessHash`, `refreshHash`, `clientId`, `userId`, `scope`, `resource`, `expiresAt`, `refreshExpiresAt`) " +
      "VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND), DATE_ADD(NOW(), INTERVAL ? SECOND))",
    [
      hashSecret(access),
      hashSecret(refresh),
      clientId,
      userId,
      scope,
      resource,
      ACCESS_TTL_SECONDS,
      REFRESH_TTL_SECONDS,
    ],
  );

  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_SECONDS,
    refresh_token: refresh,
    scope,
  };
}

/**
 * The live token behind a bearer string, or null.
 *
 * Audience is checked here rather than at the call site: a token minted for
 * some other resource must not work at this one, and forgetting that check is
 * the confused-deputy problem the spec spends most of its security section on.
 */
export async function validateAccessToken(token: string): Promise<
  | { userId: string; scope: string; clientId: string; permissions: string[] }
  | null
> {
  if (!token || token.length < 32) return null;
  const db = setupDatabase();
  const [rows]: any = await db.execute(
    "SELECT * FROM `oauth_tokens` WHERE `accessHash` = ? AND `revokedAt` IS NULL AND `expiresAt` > NOW() LIMIT 1",
    [hashSecret(token)],
  );
  const row = rows[0];
  if (!row) return null;
  if (!resourceMatches(row.resource)) return null;

  // Best effort, and deliberately not awaited into the request's critical path
  // — *Connected apps* shows it, nothing depends on it.
  db.execute("UPDATE `oauth_tokens` SET `lastUsedAt` = NOW() WHERE `id` = ?", [
    row.id,
  ]).catch(() => {});

  return {
    userId: row.userId,
    scope: row.scope,
    clientId: row.clientId,
    permissions: scopeToPermissions(row.scope),
  };
}

export const CODE_LIFETIME_SECONDS = CODE_TTL_SECONDS;
export const ACCESS_LIFETIME_SECONDS = ACCESS_TTL_SECONDS;
export const REFRESH_LIFETIME_SECONDS = REFRESH_TTL_SECONDS;
