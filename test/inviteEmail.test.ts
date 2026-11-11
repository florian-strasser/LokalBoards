import { describe, it, expect } from "vitest";
import { getBoardInviteEmail } from "../server/utils/emails";

describe("getBoardInviteEmail", () => {
  it("links the board and describes read & write access", () => {
    const { subject, html } = getBoardInviteEmail({
      appName: "LokalBoards",
      name: "Alice",
      inviterName: "Bob",
      boardName: "Roadmap",
      permission: "edit",
      boardURL: "https://boards.example.com/board/7",
      language: "en",
    });
    expect(subject).toBe("You've been invited to a board | LokalBoards");
    expect(html).toContain("Bob");
    expect(html).toContain("Roadmap");
    expect(html).toContain("read &amp; write");
    // The board link is the mail's action: a button, with the raw URL kept
    // underneath for clients that strip it.
    expect(html).toContain('href="https://boards.example.com/board/7"');
    expect(html).toContain("Open board");
  });

  it("describes read-only access for a read permission", () => {
    const { html } = getBoardInviteEmail({
      appName: "LokalBoards",
      name: "Alice",
      inviterName: "Bob",
      boardName: "Roadmap",
      permission: "read",
      boardURL: "https://x/board/1",
      language: "en",
    });
    expect(html).toContain("read-only");
    expect(html).not.toContain("read &amp; write");
  });

  it("translates (de) and escapes HTML in the board name", () => {
    const { subject, html } = getBoardInviteEmail({
      appName: "LokalBoards",
      name: "Alice",
      inviterName: "Bob",
      boardName: "<b>x</b>",
      permission: "edit",
      boardURL: "https://x/board/1",
      language: "de",
    });
    expect(subject).toBe(
      "Du wurdest zu einem Board eingeladen | LokalBoards",
    );
    expect(html).toContain("Lesen &amp; Schreiben");
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});
