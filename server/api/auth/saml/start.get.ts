import { sendRedirect } from "h3";
import { buildSaml, readSamlConfig, samlIsUsable } from "../../../utils/saml";
import { findProvider } from "../../../utils/ssoProviders";

// Step one: build an AuthnRequest and send the browser to the provider with it.
//
// No state cookie of our own here, unlike the OpenID Connect flow. SAML carries
// its own: the request id travels in the response as `InResponseTo`, and the
// assertion is signed, so the answer proves which question it answers. Building
// the request records its id (SamlRequestCache, in saml.ts), and the ACS
// accepts an answer naming it once and within the hour. What we do keep is
// `RelayState` — the provider echoes it back unchanged, and it is where the
// browser should end up.
export default defineEventHandler(async (event) => {
  const requested = String(getQuery(event).provider || "");
  const provider = requested ? findProvider(requested, event) : null;
  if (requested && (!provider || provider.kind !== "saml")) {
    event.res.statusCode = 404;
    return { error: "saml_not_configured" };
  }
  const config = (provider?.config as any) ?? readSamlConfig(event);
  if (!samlIsUsable(config)) {
    event.res.statusCode = 404;
    return { error: "saml_not_configured" };
  }

  try {
    const saml = buildSaml(config, event, provider?.id);
    const url = await saml.getAuthorizeUrlAsync("/dashboard/", undefined, {});
    return sendRedirect(event, url, 302);
  } catch (error) {
    logger.error("SAML start failed:", error);
    return sendRedirect(event, "/?sso_error=provider_unreachable", 302);
  }
});
