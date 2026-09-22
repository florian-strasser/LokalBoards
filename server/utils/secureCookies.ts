import { getRequestHeader } from "h3";

// Whether a cookie set on this response should be marked `Secure`.
//
// A Secure cookie is only ever sent back over HTTPS, and browsers disagree about
// plain http://localhost: Chrome sends it there, Safari does not. So the flag
// follows how the instance is actually reached, and any one of these says HTTPS:
//
//   - the address it is configured with (NUXT_BOARDS_URL) is https
//   - the proxy in front says so, with X-Forwarded-Proto: https
//   - the connection itself is TLS
//   - SSL=true, for a setup that can say none of the above
//
// Except on the dev server (`npm run dev`), which is reached over plain
// http://localhost however its .env says the live instance is reached. There
// the configured address says nothing about this request, and taking it at its
// word made the session cookie Secure, which Safari then refused on localhost:
// signing in to the dev server stopped working, silently, from v0.38.2 on. So
// on the dev server only the request itself counts.
//
// It used to follow NODE_ENV=production, which every real deployment sets — the
// Docker image and the Nix package both do. Over plain HTTP the session cookie
// was then set and never kept: sign-in answered as though it had worked, and the
// sign-in page came straight back with nothing to say why.

export interface SecureCookieInput {
  // True on the dev server, where NUXT_BOARDS_URL is the live address.
  dev?: boolean;
  boardsUrl?: string | null;
  forwardedProto?: string | null;
  encrypted?: boolean;
  ssl?: string | null;
}

export function wantsSecureCookies(input: SecureCookieInput): boolean {
  if (
    !input.dev &&
    String(input.boardsUrl ?? "").trim().toLowerCase().startsWith("https://")
  ) {
    return true;
  }
  // Each proxy in a chain appends its own value; the first is what the browser
  // spoke.
  const proto = String(input.forwardedProto ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  if (proto === "https") return true;
  if (input.encrypted) return true;
  return String(input.ssl ?? "").trim().toLowerCase() === "true";
}

export function secureCookiesFor(event: any): boolean {
  return wantsSecureCookies({
    dev: import.meta.dev,
    boardsUrl: useRuntimeConfig(event).boardsUrl,
    forwardedProto: getRequestHeader(event, "x-forwarded-proto"),
    encrypted: Boolean(event?.node?.req?.socket?.encrypted),
    ssl: process.env.SSL,
  });
}
