import { describe, it, expect } from "vitest";
import { createHash, randomBytes } from "node:crypto";

// The pure parts of the OAuth server: what a scope grants, whether a PKCE
// verifier matches, and which redirect targets are usable. The protocol itself
// is driven end to end by tests/oauth/run.mjs; this is the arithmetic
// underneath it, which is worth pinning where it is cheap to.
//
// Imported from the source rather than through Nitro's auto-imports, so the
// module is exercised exactly as the server loads it.
import {
  SCOPE_READ,
  SCOPE_WRITE,
  isUsableRedirect,
  normalizeScope,
  redirectAllowed,
  scopeToPermissions,
  verifyPkce,
} from "../server/utils/oauth";

describe("scopeToPermissions", () => {
  it("maps write onto the same array a full API key carries", () => {
    expect(scopeToPermissions(`${SCOPE_READ} ${SCOPE_WRITE}`)).toEqual([
      "read",
      "write",
    ]);
  });

  it("and read onto a read-only one", () => {
    expect(scopeToPermissions(SCOPE_READ)).toEqual(["read"]);
  });

  it("never grants write for a scope it does not recognise", () => {
    expect(scopeToPermissions("admin everything")).toEqual(["read"]);
    expect(scopeToPermissions("")).toEqual(["read"]);
  });
});

describe("normalizeScope", () => {
  it("keeps only the scopes this server issues", () => {
    expect(normalizeScope("boards:read boards:write openid profile")).toBe(
      "boards:read boards:write",
    );
  });

  it("never returns nothing", () => {
    expect(normalizeScope("")).toBe(SCOPE_READ);
    expect(normalizeScope(undefined)).toBe(SCOPE_READ);
    expect(normalizeScope("nonsense")).toBe(SCOPE_READ);
  });

  it("puts write in a stable order, so a stored scope compares by string", () => {
    expect(normalizeScope("boards:write boards:read")).toBe(
      normalizeScope("boards:read boards:write"),
    );
  });

  it("includes read whenever write is asked for: write implies reading", () => {
    expect(normalizeScope("boards:write")).toBe("boards:read boards:write");
  });
});

describe("verifyPkce", () => {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  it("accepts the verifier the challenge was made from", () => {
    expect(verifyPkce(verifier, challenge)).toBe(true);
  });

  it("rejects any other", () => {
    expect(verifyPkce(randomBytes(48).toString("base64url"), challenge)).toBe(false);
  });

  it("rejects an empty verifier or challenge", () => {
    expect(verifyPkce("", challenge)).toBe(false);
    expect(verifyPkce(verifier, "")).toBe(false);
  });

  it("rejects a verifier outside the length the RFC allows", () => {
    const short = "abc";
    expect(
      verifyPkce(short, createHash("sha256").update(short).digest("base64url")),
    ).toBe(false);
  });

  it("does not accept the plain verifier as its own challenge", () => {
    // S256 only: a server that fell back to `plain` would accept this.
    expect(verifyPkce(verifier, verifier)).toBe(false);
  });
});

describe("isUsableRedirect", () => {
  it("takes HTTPS anywhere", () => {
    expect(isUsableRedirect("https://chat.example/callback")).toBe(true);
  });

  it("takes HTTP on loopback, which is how a desktop client listens", () => {
    expect(isUsableRedirect("http://127.0.0.1:7777/callback")).toBe(true);
    expect(isUsableRedirect("http://localhost:7777/callback")).toBe(true);
  });

  it("refuses plain HTTP anywhere else", () => {
    expect(isUsableRedirect("http://example.com/callback")).toBe(false);
  });

  it("refuses the schemes that would make it an injection", () => {
    expect(isUsableRedirect("javascript:alert(1)")).toBe(false);
    expect(isUsableRedirect("data:text/html,hi")).toBe(false);
    expect(isUsableRedirect("file:///etc/passwd")).toBe(false);
  });

  it("refuses nonsense", () => {
    expect(isUsableRedirect("not a url")).toBe(false);
    expect(isUsableRedirect("")).toBe(false);
  });
});

describe("redirectAllowed", () => {
  const client = {
    id: "https://chat.example/client.json",
    name: "Chat",
    redirectUris: ["https://chat.example/callback"],
    tokenEndpointAuthMethod: "none",
    registration: "cimd",
  };

  it("matches the whole string, exactly", () => {
    expect(redirectAllowed(client, "https://chat.example/callback")).toBe(true);
  });

  it("does not match a prefix, a suffix or a near miss", () => {
    expect(redirectAllowed(client, "https://chat.example/callback2")).toBe(false);
    expect(redirectAllowed(client, "https://chat.example/callback/")).toBe(false);
    expect(redirectAllowed(client, "https://chat.example")).toBe(false);
    // The attack this closes: an open redirect appended to a registered URI.
    expect(
      redirectAllowed(client, "https://chat.example/callback?next=https://evil.example"),
    ).toBe(false);
  });

  it("refuses nothing at all", () => {
    expect(redirectAllowed(client, "")).toBe(false);
    expect(redirectAllowed(client, undefined)).toBe(false);
  });
});
