import { describe, it, expect } from "vitest";
import { getAccountDeletedEmail } from "../server/utils/emails";

describe("getAccountDeletedEmail", () => {
  it("includes the app name and the admin's reason", () => {
    const { subject, html } = getAccountDeletedEmail({
      appName: "LokalBoards",
      name: "Alice",
      reason: "Violated the terms of use",
      language: "en",
    });
    expect(subject).toBe("Your account has been deleted | LokalBoards");
    expect(html).toContain("Alice");
    expect(html).toContain("LokalBoards");
    expect(html).toContain("Violated the terms of use");
  });

  it("translates (de) and escapes HTML in the reason", () => {
    const { subject, html } = getAccountDeletedEmail({
      appName: "LokalBoards",
      name: "Bob",
      reason: "<script>alert(1)</script>",
      language: "de",
    });
    expect(subject).toBe("Dein Konto wurde gelöscht | LokalBoards");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
