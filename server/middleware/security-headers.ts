import { defineEventHandler, getRequestURL, setHeader } from "h3";

// Headers every response carries.
//
// - `nosniff`: a browser takes the type it is told and never guesses its way
//   from a file to a page that runs scripts.
// - The referrer stays on the instance. Other sites are not told the address
//   of the board or card somebody came from, nor the instance's own name —
//   which, for one on a private network, is nobody else's business.
// - Only the instance may show itself in a frame. Another site could
//   otherwise load a page of it invisibly and lay its own over it, so that a
//   visitor's click lands on LokalBoards: on "Allow" for an AI client wanting
//   their boards, say. `X-Frame-Options` for older browsers, `frame-ancestors`
//   for the rest. A dashboard that shows LokalBoards in a frame from another
//   address stops working with this.
//
// The pages also say that no plugin content is loaded and that a <base> may
// not point elsewhere — the parts of a content security policy that hold
// whatever the page does. Scripts and styles are left out: Nuxt writes some
// inline, and the instance's colours are an inline stylesheet, so a policy
// there would need a nonce on each. The API is left out of it too: a PDF it
// serves is drawn by the browser's own viewer, which some browsers count as
// plugin content.
export default defineEventHandler((event) => {
  setHeader(event, "x-content-type-options", "nosniff");
  setHeader(event, "referrer-policy", "same-origin");
  setHeader(event, "x-frame-options", "SAMEORIGIN");
  const page = !getRequestURL(event).pathname.startsWith("/api/");
  setHeader(
    event,
    "content-security-policy",
    page
      ? "frame-ancestors 'self'; object-src 'none'; base-uri 'self'"
      : "frame-ancestors 'self'",
  );
});
