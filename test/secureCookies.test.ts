import { describe, it, expect } from "vitest";
import { wantsSecureCookies } from "../server/utils/secureCookies";

// When a cookie is marked Secure. It follows how the instance is reached, not
// whether it runs a production build: a Secure cookie over plain HTTP is set and
// then dropped by the browser, and signing in quietly does nothing.

describe("wantsSecureCookies", () => {
  it("is off for an instance reached over plain HTTP, whatever build it is", () => {
    expect(wantsSecureCookies({ boardsUrl: "http://localhost:3000" })).toBe(false);
    expect(wantsSecureCookies({ boardsUrl: "http://boards.lan:3000" })).toBe(false);
    expect(wantsSecureCookies({})).toBe(false);
  });

  it("is on when the configured address is https", () => {
    expect(wantsSecureCookies({ boardsUrl: "https://boards.example.com" })).toBe(true);
    expect(wantsSecureCookies({ boardsUrl: "  HTTPS://Boards.Example.com/" })).toBe(true);
  });

  it("ignores the configured https address on the dev server, where it is the live one", () => {
    const live = "https://boards.example.com";
    expect(wantsSecureCookies({ dev: true, boardsUrl: live })).toBe(false);
    // The request itself still counts there.
    expect(wantsSecureCookies({ dev: true, boardsUrl: live, forwardedProto: "https" })).toBe(true);
    expect(wantsSecureCookies({ dev: true, boardsUrl: live, encrypted: true })).toBe(true);
    // And a real deployment is not affected.
    expect(wantsSecureCookies({ dev: false, boardsUrl: live })).toBe(true);
  });

  it("is on when the proxy in front says the browser used HTTPS", () => {
    expect(wantsSecureCookies({ boardsUrl: "http://localhost:3000", forwardedProto: "https" })).toBe(true);
    expect(wantsSecureCookies({ forwardedProto: "HTTPS" })).toBe(true);
  });

  it("reads the browser's own hop from a chain of proxies", () => {
    expect(wantsSecureCookies({ forwardedProto: "https, http" })).toBe(true);
    expect(wantsSecureCookies({ forwardedProto: "http, https" })).toBe(false);
  });

  it("is off when the proxy says plain HTTP", () => {
    expect(wantsSecureCookies({ forwardedProto: "http" })).toBe(false);
  });

  it("is on for a TLS connection to the app itself", () => {
    expect(wantsSecureCookies({ encrypted: true })).toBe(true);
  });

  it("is on when SSL=true says so, and only for true", () => {
    expect(wantsSecureCookies({ ssl: "true" })).toBe(true);
    expect(wantsSecureCookies({ ssl: "TRUE" })).toBe(true);
    expect(wantsSecureCookies({ ssl: "false" })).toBe(false);
    expect(wantsSecureCookies({ ssl: "1" })).toBe(false);
  });
});
