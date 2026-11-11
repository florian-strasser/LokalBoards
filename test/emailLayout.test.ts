import { describe, it, expect } from "vitest";
import {
  EMAIL_PRIMARY,
  emailButton,
  emailLayout,
  escapeEmailHtml,
} from "../server/utils/emailLayout";
import {
  getWelcomeSignupEmail,
  getWelcomeAdminEmail,
  getBoardInviteEmail,
  getAccountDeletedEmail,
  getEmailMessage,
} from "../server/utils/emails";

describe("email layout", () => {
  it("wraps content in the shared shell", () => {
    const html = emailLayout("<p>hi</p>");
    expect(html).toContain("max-width:600px");
    expect(html).toContain("<p>hi</p>");
  });

  it("renders a button with the primary colour and escapes both parts", () => {
    const html = emailButton(
      'https://example.com/?a="b"',
      '<script>x</script>',
    );
    expect(html).toContain(EMAIL_PRIMARY);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;b&quot;");
  });

  it("escapes the characters that could break out of an attribute or tag", () => {
    expect(escapeEmailHtml(`<a href="x">&'`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;",
    );
  });
});

// The point of the shared layout: no mail may fall back to bare markup.
describe("every transactional email uses the shared layout", () => {
  const mails: Record<string, string> = {
    "welcome (signup)": getWelcomeSignupEmail({
      appName: "LokalBoards",
      name: "Alice",
      loginURL: "https://boards.example.com",
    }).html,
    "welcome (admin-created)": getWelcomeAdminEmail({
      appName: "LokalBoards",
      name: "Alice",
      adminName: "Bob",
      email: "alice@example.com",
      password: "secret",
      loginURL: "https://boards.example.com",
    }).html,
    "board invitation": getBoardInviteEmail({
      appName: "LokalBoards",
      name: "Alice",
      inviterName: "Bob",
      boardName: "Roadmap",
      permission: "edit",
      boardURL: "https://boards.example.com/board/7",
    }).html,
    "account deleted": getAccountDeletedEmail({
      appName: "LokalBoards",
      name: "Alice",
      reason: "spam",
    }).html,
    "password reset": getEmailMessage(
      "reset_your_password_message",
      "https://boards.example.com/reset-password/abc",
    ),
  };

  for (const [name, html] of Object.entries(mails)) {
    it(`${name} is wrapped in the shell`, () => {
      expect(html).toContain("max-width:600px");
      expect(html).not.toMatch(/^<p>/);
    });
  }

  // Everything except the deletion notice has an action to take.
  for (const name of [
    "welcome (signup)",
    "welcome (admin-created)",
    "board invitation",
    "password reset",
  ]) {
    it(`${name} offers a button`, () => {
      expect(mails[name]).toContain(`background-color:${EMAIL_PRIMARY}`);
    });
  }
});
