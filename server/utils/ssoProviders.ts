import { ssoConfigFrom, ssoIsUsable, type SsoConfig } from "./sso";
import { samlConfigFrom, samlIsUsable, type SamlConfig } from "./saml";

// Which identity providers this instance offers.
//
// One is the common case and stays as simple as it was: set `NUXT_SSO_ISSUER`
// and friends, or the SAML equivalents, and that is a provider. An instance that
// needs more than one — a company with a partner directory, or a migration where
// both the old and the new provider have to work at once — names them:
//
//   NUXT_SSO_PROVIDERS=entra,partner
//   NUXT_SSO_ENTRA_ISSUER=https://login.microsoftonline.com/<tenant>/v2.0
//   NUXT_SSO_ENTRA_CLIENT_ID=...
//   NUXT_SSO_PARTNER_ISSUER=https://partner.example.com/oidc
//
// and every setting that exists unprefixed exists per provider under its name.
// The two forms can be used together: the unprefixed one is a provider called
// `sso` (or `saml`) alongside the named ones.
//
// The names are read from `process.env` rather than declared in the Nuxt runtime
// config, because they are not known until an instance chooses them — a config
// file cannot list keys nobody has invented yet.

export type ProviderKind = "oidc" | "saml";

export type Provider = {
  id: string;
  kind: ProviderKind;
  label: string;
  // E-mail domains this provider signs in. Used to send somebody to the right
  // one when they type their address, and — unlike `allowedDomains` — it does
  // not by itself refuse anyone.
  domains: string[];
  config: SsoConfig | SamlConfig;
};

// `partner-eu` → `PARTNER_EU`, so an id can be written the way a URL would be.
const envKey = (id: string) => id.trim().toUpperCase().replace(/[^A-Z0-9]/g, "_");

const listOf = (value: string | undefined) =>
  String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

// The per-provider variables, read into the same shape the single-provider
// readers produce. Anything not set for a named provider falls back to the
// unprefixed value, so one setting can be shared by all of them — the same
// provisioning policy, for instance, without repeating it per provider.
function overlay(prefix: string, id: string): Record<string, string> {
  const key = envKey(id);
  const out: Record<string, string> = {};
  const wanted = `${prefix}_${key}_`;
  for (const [name, value] of Object.entries(process.env)) {
    if (name.startsWith(wanted) && value != null) {
      out[name.slice(wanted.length)] = String(value);
    }
  }
  return out;
}

// A runtime-config-shaped object for one named provider: the instance-wide
// values, with that provider's own on top.
function configFor(
  base: Record<string, any>,
  prefix: string,
  id: string,
  map: Record<string, string>,
): Record<string, any> {
  const own = overlay(prefix, id);
  const merged: Record<string, any> = { ...base };
  for (const [suffix, configKey] of Object.entries(map)) {
    if (own[suffix] !== undefined) merged[configKey] = own[suffix];
  }
  return merged;
}

// Which environment suffix feeds which config key. The names on the left are
// what an administrator writes after the provider's name.
const OIDC_KEYS: Record<string, string> = {
  ENABLED: "ssoEnabled",
  LABEL: "ssoLabel",
  ISSUER: "ssoIssuer",
  CLIENT_ID: "ssoClientId",
  CLIENT_SECRET: "ssoClientSecret",
  SCOPES: "ssoScopes",
  PROVISION: "ssoProvision",
  ALLOWED_DOMAINS: "ssoAllowedDomains",
  ADMIN_CLAIM: "ssoAdminClaim",
  ADMIN_VALUE: "ssoAdminValue",
  CLAIM_SUBJECT: "ssoClaimSubject",
  CLAIM_EMAIL: "ssoClaimEmail",
  CLAIM_NAME: "ssoClaimName",
  AUTHORIZATION_URL: "ssoAuthorizationUrl",
  TOKEN_URL: "ssoTokenUrl",
  USERINFO_URL: "ssoUserinfoUrl",
};

const SAML_KEYS: Record<string, string> = {
  ENABLED: "samlEnabled",
  LABEL: "samlLabel",
  ENTRY_POINT: "samlEntryPoint",
  IDP_CERT: "samlIdpCert",
  IDP_ISSUER: "samlIdpIssuer",
  ENTITY_ID: "samlEntityId",
  IDENTIFIER_FORMAT: "samlIdentifierFormat",
  SIGNATURE_ALGORITHM: "samlSignatureAlgorithm",
  CLOCK_SKEW_SECONDS: "samlClockSkewSeconds",
  DISABLE_REQUESTED_AUTHN_CONTEXT: "samlDisableRequestedAuthnContext",
  WANT_RESPONSE_SIGNED: "samlWantResponseSigned",
  DECRYPTION_KEY: "samlDecryptionKey",
  DECRYPTION_CERT: "samlDecryptionCert",
  ALLOW_IDP_INITIATED: "samlAllowIdpInitiated",
  ATTRIBUTE_SUBJECT: "samlAttributeSubject",
  ATTRIBUTE_EMAIL: "samlAttributeEmail",
  ATTRIBUTE_NAME: "samlAttributeName",
  ADMIN_ATTRIBUTE: "samlAdminAttribute",
  ADMIN_VALUE: "samlAdminValue",
  PROVISION: "samlProvision",
  ALLOWED_DOMAINS: "samlAllowedDomains",
};

export function listProviders(event?: any): Provider[] {
  const base: Record<string, any> = { ...(useRuntimeConfig(event) as any) };
  const providers: Provider[] = [];

  const addOidc = (id: string, config: any) => {
    const parsed = ssoConfigFrom(config);
    if (!ssoIsUsable(parsed)) return;
    providers.push({
      id,
      kind: "oidc",
      label: parsed.label,
      domains: listOf(config.ssoDomains).map((d) => d.toLowerCase()),
      config: parsed,
    });
  };
  const addSaml = (id: string, config: any) => {
    const parsed = samlConfigFrom(config);
    if (!samlIsUsable(parsed)) return;
    providers.push({
      id,
      kind: "saml",
      label: parsed.label,
      domains: listOf(config.samlDomains).map((d) => d.toLowerCase()),
      config: parsed,
    });
  };

  // The unprefixed pair, when configured.
  addOidc("sso", base);
  addSaml("saml", base);

  for (const id of listOf(process.env.NUXT_SSO_PROVIDERS)) {
    if (id === "sso") continue; // already added, and its name is taken
    const own = overlay("NUXT_SSO", id);
    const config = configFor(base, "NUXT_SSO", id, OIDC_KEYS);
    // A named provider is on unless it says otherwise: naming it is the switch.
    if (own.ENABLED === undefined) config.ssoEnabled = "true";
    config.ssoLabel = own.LABEL ?? id;
    config.ssoDomains = own.DOMAINS ?? "";
    addOidc(id, config);
  }

  for (const id of listOf(process.env.NUXT_SAML_PROVIDERS)) {
    if (id === "saml") continue;
    const own = overlay("NUXT_SAML", id);
    const config = configFor(base, "NUXT_SAML", id, SAML_KEYS);
    if (own.ENABLED === undefined) config.samlEnabled = "true";
    config.samlLabel = own.LABEL ?? id;
    config.samlDomains = own.DOMAINS ?? "";
    addSaml(id, config);
  }

  return providers;
}

export function findProvider(id: string, event?: any): Provider | null {
  const wanted = String(id || "").trim();
  if (!wanted) return null;
  return listProviders(event).find((provider) => provider.id === wanted) ?? null;
}

/**
 * The provider a sign-in step is for: the one named, or the unprefixed one —
 * `sso` or `saml` — when no name is given. Null, which the endpoints answer
 * with a 404, when the name is unknown, names a provider of the other kind, or
 * the provider is not configured well enough to use (listProviders leaves
 * those out).
 */
export function requestedProvider(
  kind: "oidc",
  name: string,
  event?: any,
): (Provider & { config: SsoConfig }) | null;
export function requestedProvider(
  kind: "saml",
  name: string,
  event?: any,
): (Provider & { config: SamlConfig }) | null;
export function requestedProvider(
  kind: ProviderKind,
  name: string,
  event?: any,
): Provider | null {
  const provider = findProvider(name || (kind === "oidc" ? "sso" : "saml"), event);
  return provider?.kind === kind ? provider : null;
}

/** Where a provider's sign-in button goes. */
export function providerStartPath(provider: Provider): string {
  const route = provider.kind === "oidc" ? "sso" : "saml";
  return `/api/auth/${route}/start?provider=${encodeURIComponent(provider.id)}`;
}

// Which provider signs in this address, if any. Longest domain wins, so a
// subsidiary's own provider beats the parent's catch-all.
export function providerForEmail(
  email: string,
  event?: any,
): Provider | null {
  const domain = String(email || "").split("@")[1]?.trim().toLowerCase();
  if (!domain) return null;
  const matches = listProviders(event).filter((provider) =>
    provider.domains.some(
      (candidate) => domain === candidate || domain.endsWith(`.${candidate}`),
    ),
  );
  return (
    matches.sort((a, b) => Math.max(...b.domains.map((d) => d.length)) - Math.max(...a.domains.map((d) => d.length)))[0] ?? null
  );
}
