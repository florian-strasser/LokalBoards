import { deleteCookie, getCookie, getQuery, sendRedirect } from "h3";
import { createSession } from "../../../utils/auth";
import { requestedProvider } from "../../../utils/ssoProviders";
import {
  claimsAreValid,
  decodeIdToken,
  domainAllowed,
  findOrCreateUser,
  profileFromClaims,
  resolveEndpoints,
  safeEqual,
  ssoSubject,
} from "../../../utils/sso";

// Step two: the provider has sent the browser back with a code.
//
// Everything that can go wrong sends the visitor to the sign-in page with a
// reason in the query string, which the page turns into a sentence. Nothing
// here renders a page of its own — a dead end with a stack trace is not a way
// to tell somebody their account is not on the list.
const fail = (event: any, reason: string) =>
  sendRedirect(event, `/?sso_error=${encodeURIComponent(reason)}`, 302);

export default defineEventHandler(async (event) => {
  // The provider is taken from the cookie the start endpoint set, never from
  // the query string: it decides which issuer and client the token is checked
  // against, and that must be the one this browser was actually sent to.
  const provider = requestedProvider(
    "oidc",
    getCookie(event, "sso_provider") || "",
    event,
  );
  if (!provider) {
    event.res.statusCode = 404;
    return { error: "sso_not_configured" };
  }
  const { config } = provider;

  const query = getQuery(event);
  const state = getCookie(event, "sso_state") || "";
  const nonce = getCookie(event, "sso_nonce") || "";
  const verifier = getCookie(event, "sso_verifier") || "";
  for (const name of ["sso_state", "sso_nonce", "sso_verifier", "sso_provider"]) {
    deleteCookie(event, name, { path: "/" });
  }

  // The provider itself refused — consent declined, or a policy said no.
  if (query.error) {
    logger.warn("SSO provider returned an error:", String(query.error));
    return fail(event, "provider_error");
  }

  const code = String(query.code || "");
  if (!code) return fail(event, "no_code");

  // A callback that does not carry this browser's state is not this browser's
  // sign-in. It is either stale or somebody else's.
  if (!state || !safeEqual(String(query.state || ""), state)) {
    return fail(event, "state_mismatch");
  }

  try {
    const endpoints = await resolveEndpoints(config);

    // The exchange happens from here, never from the browser: the client secret
    // is in this request, and the tokens that come back never leave the server.
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: ssoRedirectUri(event),
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code_verifier: verifier,
    });

    // `accept: application/json` because not every OAuth 2.0 provider answers in
    // JSON unless asked — GitHub's token endpoint returns a form-encoded body by
    // default — and the answer is parsed either way for the ones that ignore it.
    let tokens: any = await $fetch(endpoints.tokenUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: body.toString(),
      timeout: 15_000,
    });
    if (typeof tokens === "string") {
      tokens = Object.fromEntries(new URLSearchParams(tokens));
    }

    if (!tokens?.id_token && !tokens?.access_token) {
      return fail(event, "no_token");
    }

    let claims = decodeIdToken(tokens.id_token || "");
    if (tokens.id_token) {
      const verdict = claimsAreValid(claims, {
        issuer: endpoints.issuer || config.issuer,
        clientId: config.clientId,
        nonce,
      });
      if (!verdict.ok) {
        logger.warn("SSO token rejected:", verdict.reason);
        return fail(event, verdict.reason);
      }
    }

    // The ID token carries enough for most providers. Where it does not — some
    // are sparing with claims unless asked — the userinfo endpoint fills in the
    // address and the name, and the subject must match what the token said.
    const needsProfile = !claims?.email || !claims?.name;
    if (needsProfile && endpoints.userinfoUrl && tokens.access_token) {
      try {
        const info: any = await $fetch(endpoints.userinfoUrl, {
          headers: { authorization: `Bearer ${tokens.access_token}` },
          timeout: 15_000,
        });
        // Read through the configured mapping, so the check still holds when the
        // provider calls its subject something other than `sub`.
        const fromToken = claims ? ssoSubject(claims, config) : "";
        const fromUserinfo = ssoSubject(info || {}, config);
        if (!fromToken || !fromUserinfo || fromToken === fromUserinfo) {
          claims = { ...(claims || {}), ...info };
        }
      } catch (error) {
        logger.warn("SSO userinfo request failed:", error);
      }
    }

    const profile = profileFromClaims(claims || {}, config);
    if (!profile) return fail(event, "no_email");
    if (!domainAllowed(profile.email, config)) return fail(event, "domain_not_allowed");

    const result = await findOrCreateUser(profile, config);
    if ("error" in result) return fail(event, result.error);

    const session = await createSession(event, result.userId);
    if (session.error) {
      logger.error("SSO session creation failed:", session.error);
      return fail(event, "session_failed");
    }

    return sendRedirect(event, "/dashboard/", 302);
  } catch (error) {
    logger.error("SSO callback failed:", error);
    return fail(event, "exchange_failed");
  }
});
