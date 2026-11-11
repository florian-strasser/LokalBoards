import { getQuery } from "h3";
import { providerForEmail, providerStartPath } from "../../../utils/ssoProviders";

// Which provider signs in this address, if any — so somebody typing a work
// address is offered their own organisation's button rather than having to know
// which of several is theirs.
//
// It answers only about the address it was given, and only ever with a provider
// that is already listed on the page. That matters: an endpoint that said
// whether an address had an *account* here would be a way to enumerate the
// people who use this instance. This says nothing about accounts.
export default defineEventHandler((event) => {
  const email = String(getQuery(event).email || "");
  const provider = providerForEmail(email, event);
  if (!provider) return { provider: null };
  return {
    provider: {
      id: provider.id,
      kind: provider.kind,
      label: provider.label,
      start: providerStartPath(provider),
    },
  };
});
