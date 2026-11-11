import { buildSaml, pem } from "../../../utils/saml";
import { requestedProvider } from "../../../utils/ssoProviders";

// The document to hand an administrator setting this up at the other end: our
// entity id, where to send assertions, and which name identifier we want.
// Most providers can be pointed at this URL and configure themselves from it.
//
// It carries no secrets — it is the public half of the arrangement, and the
// same information the provider would otherwise be typed by hand.
export default defineEventHandler((event) => {
  const provider = requestedProvider(
    "saml",
    String(getQuery(event).provider || ""),
    event,
  );
  if (!provider) {
    event.res.statusCode = 404;
    return { error: "saml_not_configured" };
  }
  const { config } = provider;

  // The encryption certificate goes in the document when one is configured:
  // that is how a provider learns which key to encrypt assertions for. Without
  // it the element is simply absent, which is what an unencrypted arrangement
  // looks like. node-saml wants it with its PEM armour here, which the
  // configuration has taken off.
  const xml = buildSaml(config, event, provider.id).generateServiceProviderMetadata(
    config.decryptionCert ? pem(config.decryptionCert, "CERTIFICATE") : null,
    null,
  );
  setHeader(event, "content-type", "application/samlmetadata+xml");
  setHeader(
    event,
    "content-disposition",
    'inline; filename="lokalboards-sp-metadata.xml"',
  );
  return xml;
});
