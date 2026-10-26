import { readBody, sendRedirect } from "h3";
import { createSession } from "../../../utils/auth";
import { domainAllowed, findOrCreateUser } from "../../../utils/sso";
import {
  acceptAssertion,
  buildSaml,
  profileFromAssertion,
  readSamlConfig,
  samlIsUsable,
} from "../../../utils/saml";
import { findProvider, listProviders } from "../../../utils/ssoProviders";
import type { SamlConfig } from "../../../utils/saml";

// Step two: the assertion consumer service. The provider POSTs a signed
// response here through the browser.
//
// `validatePostResponseAsync` is where the security lives: it checks the XML
// signature against the configured certificate, that the signature covers the
// assertion actually being read (which is the defence against signature
// wrapping), the audience, the destination, the conditions, the clock, and —
// when the answer names a request — that it is one this instance sent and has
// not been answered yet. It throws on anything it does not like, and
// everything it throws for is a refusal here — there is no partial acceptance.
const fail = (event: any, reason: string) =>
  sendRedirect(event, `/?sso_error=${encodeURIComponent(reason)}`, 302);

export default defineEventHandler(async (event) => {
  // Which provider this response belongs to. With one configured it is that
  // one; with several, the ACS carries the provider's name — `?provider=partner`
  // — because each is registered with its own URL at its own end.
  const requested = String(getQuery(event).provider || "");
  const provider = requested ? findProvider(requested, event) : null;
  let config: SamlConfig = (provider?.config as SamlConfig) ?? readSamlConfig(event);

  if (requested && (!provider || provider.kind !== "saml")) {
    event.res.statusCode = 404;
    return { error: "saml_not_configured" };
  }
  if (!samlIsUsable(config)) {
    event.res.statusCode = 404;
    return { error: "saml_not_configured" };
  }

  try {
    const body = await readBody(event);
    const samlResponse = String(body?.SAMLResponse || "");
    if (!samlResponse) return fail(event, "no_assertion");

    const saml = buildSaml(config, event, provider?.id);
    const { profile: assertion } = await saml.validatePostResponseAsync({
      SAMLResponse: samlResponse,
      RelayState: String(body?.RelayState || ""),
    });

    if (!assertion) return fail(event, "no_assertion");

    // Provider-initiated sign-in only where it is allowed, every assertion
    // used once (solicited ones too — see consumeAssertion), and the issuer
    // pinned where one is configured.
    const accepted = await acceptAssertion(assertion, config);
    if (!accepted.ok) return fail(event, accepted.reason);

    const profile = profileFromAssertion(assertion as any, config);
    if (!profile) return fail(event, "no_email");
    if (!domainAllowed(profile.email, config)) {
      return fail(event, "domain_not_allowed");
    }

    const result = await findOrCreateUser(profile, config, "saml");
    if ("error" in result) return fail(event, result.error);

    const session = await createSession(event, result.userId);
    if (session.error) {
      logger.error("SAML session creation failed:", session.error);
      return fail(event, "session_failed");
    }

    // `RelayState` is where the provider was asked to send us back to, and it is
    // echoed by the provider rather than trusted from it: anything that is not a
    // path on this instance goes to the dashboard instead, so a crafted response
    // cannot use us as an open redirect.
    const relay = String(body?.RelayState || "");
    const destination = /^\/[^/\\]/.test(relay) ? relay : "/dashboard/";
    return sendRedirect(event, destination, 302);
  } catch (error) {
    // node-saml throws for a bad signature, a wrong audience, an expired
    // assertion and a replayed one alike. The visitor is told the sign-in could
    // not be verified; the detail goes to the log, where it belongs.
    logger.error("SAML assertion rejected:", error);
    return fail(event, "assertion_invalid");
  }
});
