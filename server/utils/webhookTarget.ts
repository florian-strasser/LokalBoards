import { checkPublicUrl, isPublicAddress, type LookupFunction } from "./netGuard";

// The webhook URL is supplied by a user but fetched by the SERVER, from inside
// whatever network the instance runs in. Without a check that is a
// server-side request forgery primitive: cloud metadata (169.254.169.254),
// admin panels on localhost, anything on the private LAN. So a target is only
// accepted if it is http(s) AND every address its host resolves to is a public
// unicast address. netGuard.ts decides what counts as public.
//
// This is the check with a reason, run when the subscription is created so the
// user gets an immediate, readable error. It is not what keeps a delivery
// safe: a hostname that resolved publicly yesterday can point at an internal
// address today, or between this check and the connect. Deliveries go through
// safeFetch, which runs the same rules inside the connection's own DNS lookup.

export type WebhookTargetCheck = { ok: true } | { ok: false; reason: string };

/** Whether an address is outside every public unicast range (or not an IP at all). */
export function isPrivateAddress(ip: string): boolean {
  return !isPublicAddress(ip);
}

/**
 * Validate a webhook URL: shape, scheme, length, no credentials, and that its
 * host does not resolve into a private, loopback, link-local or otherwise
 * reserved range.
 */
export async function checkWebhookTarget(
  url: unknown,
  opts: { lookup?: LookupFunction } = {},
): Promise<WebhookTargetCheck> {
  if (!url || typeof url !== "string") {
    return {
      ok: false,
      reason: "A webhook URL (max 2048 characters) is required",
    };
  }

  const check = await checkPublicUrl(url, { lookup: opts.lookup });
  if (check.ok) return { ok: true };

  switch (check.reason) {
    case "URL_TOO_LONG":
      return {
        ok: false,
        reason: "A webhook URL (max 2048 characters) is required",
      };
    case "INVALID_URL":
      return { ok: false, reason: "The webhook URL is not a valid URL" };
    case "UNSUPPORTED_PROTOCOL":
      return {
        ok: false,
        reason: "The webhook URL must start with http:// or https://",
      };
    case "CREDENTIALS_IN_URL":
      // fetch() refused these at delivery anyway; now they are refused where
      // the user can see why. A receiver that wants a secret gets the signature.
      return {
        ok: false,
        reason:
          "The webhook URL must not contain a user name or password; use the secret instead",
      };
    case "DNS_FAILED":
      return { ok: false, reason: "The webhook host could not be resolved" };
    default:
      return {
        ok: false,
        reason: "The webhook URL must point to a public address",
      };
  }
}
