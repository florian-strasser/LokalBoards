import { describe, it, expect } from "vitest";
import {
  getWelcomeSignupEmail,
  getWelcomeAdminEmail,
} from "../server/utils/emails";

describe("getWelcomeSignupEmail", () => {
  it("fills the name/appName and links the login URL, no credentials", () => {
    const { subject, html } = getWelcomeSignupEmail({
      appName: "LokalBoards",
      name: "Alice",
      loginURL: "https://boards.example.com",
      language: "en",
    });
    expect(subject).toBe("Welcome | LokalBoards");
    expect(html).toContain("Alice");
    expect(html).toContain("LokalBoards");
    // The login link is the mail's action: a button, with the raw URL kept
    // underneath for clients that strip it.
    expect(html).toContain('href="https://boards.example.com"');
    expect(html).toContain("Sign in");
    // A self-signup email must not contain a password line.
    expect(html).not.toContain("Password:");
  });

  it("falls back to English for an unknown language", () => {
    const { subject } = getWelcomeSignupEmail({
      appName: "App",
      name: "X",
      loginURL: "https://x",
      language: "xx",
    });
    expect(subject).toBe("Welcome | App");
  });
});

describe("getWelcomeAdminEmail", () => {
  it("names the creating admin and includes the credentials", () => {
    const { html } = getWelcomeAdminEmail({
      appName: "LokalBoards",
      name: "Bob",
      adminName: "Carol",
      email: "bob@example.com",
      password: "s3cret-pw",
      loginURL: "https://boards.example.com",
      language: "en",
    });
    expect(html).toContain("Carol"); // "created ... by Carol"
    expect(html).toContain("bob@example.com");
    expect(html).toContain("s3cret-pw");
    expect(html).toContain('<a href="https://boards.example.com"');
  });

  it("translates (de) and escapes HTML in user-supplied values", () => {
    const { subject, html } = getWelcomeAdminEmail({
      appName: "LokalBoards",
      name: "<b>Mallory</b>",
      adminName: "Carol",
      email: "m@example.com",
      password: "pw",
      loginURL: "https://x",
      language: "de",
    });
    expect(subject).toBe("Willkommen | LokalBoards");
    // The injected markup must be escaped, not rendered.
    expect(html).not.toContain("<b>Mallory</b>");
    expect(html).toContain("&lt;b&gt;Mallory&lt;/b&gt;");
  });
});
