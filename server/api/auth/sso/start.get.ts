import { secureCookiesFor } from "../../../utils/secureCookies";
import { sendRedirect, setCookie } from "h3";
import { requestedProvider } from "../../../utils/ssoProviders";
import { pkceChallenge, randomToken, resolveEndpoints } from "../../../utils/sso";

// Step one of the sign-in: hand the browser to the provider.
//
// Three secrets are minted here and kept in cookies for the couple of minutes
// the round trip takes. They are the whole of the flow's integrity:
//
//   state     ties the callback to this browser, so somebody else's callback
//             cannot be replayed into your session (CSRF).
//   nonce     ties the ID token to this attempt, so an older token for the same
//             user cannot be replayed either.
//   verifier  proves at the token endpoint that whoever redeems the code is who
//             asked for it (PKCE), which matters when a code leaks through a
//             referrer, a log or a shared machine.
//
// `httpOnly` so no script can read them, `sameSite: lax` because the provider
// redirects back with a GET and a stricter setting would drop them exactly then.
export default defineEventHandler(async (event) => {
  const provider = requestedProvider(
    "oidc",
    String(getQuery(event).provider || ""),
    event,
  );
  if (!provider) {
    event.res.statusCode = 404;
    return { error: "sso_not_configured" };
  }
  const { config } = provider;

  try {
    const endpoints = await resolveEndpoints(config);
    const state = randomToken();
    const nonce = randomToken();
    const verifier = randomToken(48);

    const cookie = {
      httpOnly: true,
      sameSite: "lax" as const,
      path: "/",
      maxAge: 600,
      secure: secureCookiesFor(event),
    };
    setCookie(event, "sso_state", state, cookie);
    setCookie(event, "sso_nonce", nonce, cookie);
    setCookie(event, "sso_verifier", verifier, cookie);
    // Which provider this attempt belongs to, so the callback verifies the
    // token against the right issuer and client.
    setCookie(event, "sso_provider", provider.id, cookie);

    const url = new URL(endpoints.authorizationUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", ssoRedirectUri(event));
    url.searchParams.set("scope", config.scopes);
    url.searchParams.set("state", state);
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("code_challenge", pkceChallenge(verifier));
    url.searchParams.set("code_challenge_method", "S256");

    return sendRedirect(event, url.toString(), 302);
  } catch (error) {
    logger.error("SSO start failed:", error);
    return sendRedirect(event, "/?sso_error=provider_unreachable", 302);
  }
});
