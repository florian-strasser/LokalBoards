import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { setupDatabase } from "../../app/lib/databaseSetup";

// Single sign-on against any OpenID Connect provider — Entra ID, Google
// Workspace, Okta, Keycloak, Authentik, Auth0, Zitadel, whatever the
// organisation already runs.
//
// The authorization code flow with PKCE, which is what every current provider
// wants and the only flow that keeps the tokens off the browser entirely: the
// browser only ever carries a one-time code, and the exchange for it happens
// from the server, authenticated with the client secret.
//
// The ID token is read for its claims but its signature is not checked, which
// is what OpenID Connect Core §3.1.3.7 allows when the token came straight from
// the token endpoint over TLS to a client that authenticated itself — the
// channel is the proof. Everything that a signature would not cover is checked
// here regardless: the issuer, the audience, the expiry and the nonce.

export type SsoConfig = {
  enabled: boolean;
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  label: string;
  // "auto" creates an account the first time somebody signs in; "existing"
  // refuses anyone who does not already have one, for organisations that want
  // the account list to stay a deliberate thing.
  provision: "auto" | "existing";
  allowedDomains: string[];
  adminClaim: string;
  adminValue: string;
  // Which fields in the provider's response hold the identity. Defaults are the
  // OpenID Connect names; a plain OAuth 2.0 provider often uses its own.
  claimSubject: string;
  claimEmail: string;
  claimName: string;
  // Filled in from discovery unless the provider was configured by hand.
  authorizationUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
};

export function readSsoConfig(event?: any): SsoConfig {
  return ssoConfigFrom(useRuntimeConfig(event) as any);
}

// The same reading, from a plain object rather than the runtime config, so a
// named provider's own settings can be layered over the instance-wide ones
// before being parsed. See `ssoProviders.ts`.
export function ssoConfigFrom(config: any): SsoConfig {
  const truthy = (value: any) =>
    value === true || String(value).toLowerCase() === "true";

  return {
    enabled: truthy(config.ssoEnabled),
    issuer: String(config.ssoIssuer || "").replace(/\/+$/, ""),
    clientId: String(config.ssoClientId || ""),
    clientSecret: String(config.ssoClientSecret || ""),
    scopes: String(config.ssoScopes || "openid profile email"),
    label: String(config.ssoLabel || "Single sign-on"),
    provision:
      String(config.ssoProvision || "auto").toLowerCase() === "existing"
        ? "existing"
        : "auto",
    allowedDomains: String(config.ssoAllowedDomains || "")
      .split(",")
      .map((domain) => domain.trim().toLowerCase())
      .filter(Boolean),
    adminClaim: String(config.ssoAdminClaim || ""),
    adminValue: String(config.ssoAdminValue || ""),
    claimSubject: String(config.ssoClaimSubject || ""),
    claimEmail: String(config.ssoClaimEmail || ""),
    claimName: String(config.ssoClaimName || ""),
    authorizationUrl: String(config.ssoAuthorizationUrl || ""),
    tokenUrl: String(config.ssoTokenUrl || ""),
    userinfoUrl: String(config.ssoUserinfoUrl || ""),
  };
}

// Whether the instance is configured well enough to offer the button at all.
// Half-configured is the same as off: a button that leads to an error page is
// worse than no button.
export function ssoIsUsable(config: SsoConfig): boolean {
  if (!config.enabled) return false;
  if (!config.clientId || !config.clientSecret) return false;
  return Boolean(
    config.issuer || (config.authorizationUrl && config.tokenUrl),
  );
}

// The provider's own description of itself. Fetched once and kept, because it
// changes about as often as the provider does and every sign-in would otherwise
// pay for a second round trip.
type Discovery = {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  issuer: string;
};
let discovered: { issuer: string; at: number; document: Discovery } | null =
  null;
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

export async function resolveEndpoints(config: SsoConfig): Promise<{
  authorizationUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  issuer: string;
}> {
  // Configured by hand: a provider that does not publish a discovery document,
  // or an administrator who would rather pin the three URLs.
  if (config.authorizationUrl && config.tokenUrl) {
    return {
      authorizationUrl: config.authorizationUrl,
      tokenUrl: config.tokenUrl,
      userinfoUrl: config.userinfoUrl,
      issuer: config.issuer,
    };
  }

  if (
    discovered &&
    discovered.issuer === config.issuer &&
    Date.now() - discovered.at < DISCOVERY_TTL_MS
  ) {
    return {
      authorizationUrl: discovered.document.authorization_endpoint,
      tokenUrl: discovered.document.token_endpoint,
      userinfoUrl: discovered.document.userinfo_endpoint || "",
      issuer: discovered.document.issuer,
    };
  }

  const url = `${config.issuer}/.well-known/openid-configuration`;
  const document = (await $fetch(url, {
    timeout: 10_000,
  })) as Discovery;

  if (!document?.authorization_endpoint || !document?.token_endpoint) {
    throw new Error(`SSO discovery at ${url} returned no endpoints`);
  }

  discovered = { issuer: config.issuer, at: Date.now(), document };
  return {
    authorizationUrl: document.authorization_endpoint,
    tokenUrl: document.token_endpoint,
    userinfoUrl: document.userinfo_endpoint || "",
    issuer: document.issuer,
  };
}

// Only for the tests, which stand up a provider per case on a fresh port.
export function forgetDiscovery() {
  discovered = null;
}

// --- the short-lived state that ties one sign-in attempt together -----------

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(String(a), "utf8");
  const right = Buffer.from(String(b), "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

// --- claims -----------------------------------------------------------------

// The middle segment of a JWT, without verifying the signature — see the note
// at the top of this file for why that is enough here, and what is checked
// instead.
export function decodeIdToken(token: string): Record<string, any> | null {
  const parts = String(token).split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function claimsAreValid(
  claims: Record<string, any> | null,
  expected: { issuer: string; clientId: string; nonce: string },
): { ok: true } | { ok: false; reason: string } {
  if (!claims) return { ok: false, reason: "id_token_unreadable" };

  // The issuer has to be the one we asked, or a token from somewhere else
  // would do just as well.
  const issuer = String(claims.iss || "").replace(/\/+$/, "");
  if (!expected.issuer || issuer !== expected.issuer.replace(/\/+$/, "")) {
    return { ok: false, reason: "issuer_mismatch" };
  }

  // And we have to be the audience, or a token minted for another application
  // at the same provider would be accepted here.
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audience.map(String).includes(expected.clientId)) {
    return { ok: false, reason: "audience_mismatch" };
  }

  if (claims.exp && Number(claims.exp) * 1000 < Date.now()) {
    return { ok: false, reason: "id_token_expired" };
  }

  // The nonce is what makes this token an answer to *this* sign-in rather than
  // a replay of an older one.
  if (!claims.nonce || !safeEqual(String(claims.nonce), expected.nonce)) {
    return { ok: false, reason: "nonce_mismatch" };
  }

  return { ok: true };
}

// --- the user behind the claims ---------------------------------------------

// Reads one value out of the provider's response.
//
// A field name, or several separated by commas and tried in order — providers
// disagree about where an address lives, and some leave their first choice empty
// rather than absent. Dots step into nested objects, for the providers that wrap
// everything in a `data` or an `attributes`.
//
//   "email"                     → claims.email
//   "email,primary_email"       → whichever of the two has something in it
//   "data.attributes.mail"      → claims.data.attributes.mail
export function pickClaim(
  source: Record<string, any>,
  spec: string,
): string {
  for (const candidate of String(spec).split(",")) {
    const path = candidate.trim();
    if (!path) continue;
    let value: any = source;
    for (const step of path.split(".")) {
      value = value?.[step];
      if (value === undefined || value === null) break;
    }
    // A number is a perfectly good subject — GitHub's is one — so anything that
    // is not an object and has some text to it counts.
    if (value !== undefined && value !== null && typeof value !== "object") {
      const text = String(value).trim();
      if (text) return text;
    }
  }
  return "";
}

export type SsoProfile = {
  subject: string;
  email: string;
  name: string;
  isAdmin: boolean;
};

export function profileFromClaims(
  claims: Record<string, any>,
  config: SsoConfig,
): SsoProfile | null {
  const subject = ssoSubject(claims, config);
  const email = pickClaim(
    claims,
    config.claimEmail || "email,preferred_username",
  )
    .trim()
    .toLowerCase();
  if (!subject || !email) return null;

  const name =
    pickClaim(claims, config.claimName || "name") ||
    [claims.given_name, claims.family_name].filter(Boolean).join(" ").trim() ||
    email.split("@")[0];

  // An optional claim that says who administers this instance, so an
  // organisation can run its admin list from its own directory rather than
  // here. Matches a string claim or any entry of a list one, which is how
  // groups and roles arrive.
  let isAdmin = false;
  if (config.adminClaim && config.adminValue) {
    const value = claims[config.adminClaim];
    const entries = Array.isArray(value) ? value.map(String) : [String(value ?? "")];
    isAdmin = entries.includes(config.adminValue);
  }

  return { subject, email, name, isAdmin };
}

// The provider's own identifier for this person, which is what the account is
// linked by. Read through the same mapping everywhere, so a configured subject
// field is used consistently — including when the userinfo response is checked
// against the ID token.
export function ssoSubject(
  claims: Record<string, any>,
  config: SsoConfig,
): string {
  return pickClaim(claims, config.claimSubject || "sub");
}

export function domainAllowed(email: string, config: SsoConfig): boolean {
  if (!config.allowedDomains.length) return true;
  const domain = email.split("@")[1]?.toLowerCase() || "";
  return config.allowedDomains.includes(domain);
}

// Find the account this subject belongs to, or make one.
//
// Three cases, in order: this subject has signed in before; somebody with this
// address already has an account, made here or invited, and this is the first
// time they have come through the provider; or nobody has this address yet.
//
// The second is the one worth being careful about. Linking on a matching
// address is what makes SSO adoptable at all — an organisation that has been
// using the instance for a year does not want everybody starting again — and it
// is only safe because the address comes from the provider the administrator
// configured, over a channel authenticated with the client secret. It is not a
// self-declared address from a form.
export async function findOrCreateUser(
  profile: SsoProfile,
  config: SsoConfig,
  // Which kind of single sign-on this was. Both land in the same `account`
  // table beside local passwords, told apart by this, so one person can have a
  // password, an OpenID Connect identity and a SAML identity without any of
  // them standing on the others.
  providerId: "sso" | "saml" = "sso",
  retried = false,
): Promise<{ userId: string } | { error: string }> {
  const db = setupDatabase();
  const { v4: uuidv4 } = await import("uuid");

  const [linked]: any = await db.execute(
    "SELECT `userId` FROM `account` WHERE `providerId` = ? AND `accountId` = ? LIMIT 1",
    [providerId, profile.subject],
  );
  if (linked[0]?.userId) {
    await applyAdminRole(db, linked[0].userId, profile, config);
    return { userId: linked[0].userId };
  }

  const [existing]: any = await db.execute(
    "SELECT `id` FROM `user` WHERE LOWER(`email`) = ? LIMIT 1",
    [profile.email],
  );

  if (existing[0]?.id) {
    await db.execute(
      "INSERT INTO `account` (`id`, `accountId`, `providerId`, `userId`) VALUES (?, ?, ?, ?)",
      [uuidv4(), profile.subject, providerId, existing[0].id],
    );
    await applyAdminRole(db, existing[0].id, profile, config);
    return { userId: existing[0].id };
  }

  if (config.provision !== "auto") {
    return { error: "no_account" };
  }

  const userId = uuidv4();
  try {
    await db.execute(
      "INSERT INTO `user` (`id`, `name`, `email`, `emailVerified`, `role`, `onboarded`) VALUES (?, ?, ?, 1, ?, 0)",
      [userId, profile.name, profile.email, profile.isAdmin ? "admin" : "user"],
    );
  } catch (error: any) {
    // `user.email` is unique: two first sign-ins for one address at once (a
    // double click at the provider) and the other one made the account. Go
    // round again and link to it, once.
    if (error?.code === "ER_DUP_ENTRY" && !retried) {
      return findOrCreateUser(profile, config, providerId, true);
    }
    throw error;
  }
  await db.execute(
    "INSERT INTO `account` (`id`, `accountId`, `providerId`, `userId`) VALUES (?, ?, ?, ?)",
    [uuidv4(), profile.subject, providerId, userId],
  );
  return { userId };
}

// The directory's answer wins on every sign-in, in both directions: somebody
// added to the admin group becomes an administrator here, and somebody removed
// from it stops being one. Only when the instance is configured to read a claim
// at all — otherwise roles are managed here and SSO must not touch them.
async function applyAdminRole(
  db: any,
  userId: string,
  profile: SsoProfile,
  config: SsoConfig,
) {
  if (!config.adminClaim || !config.adminValue) return;
  await db.execute("UPDATE `user` SET `role` = ? WHERE `id` = ?", [
    profile.isAdmin ? "admin" : "user",
    userId,
  ]);
}
