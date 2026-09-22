import { describe, it, expect } from "vitest";
import {
  parseTrelloShortLink,
  checklistToMarkdown,
  linkAttachmentsToMarkdown,
  trelloJsonToBoard,
} from "../server/utils/trelloImport";

describe("parseTrelloShortLink", () => {
  it("extracts the shortLink from board URLs", () => {
    expect(parseTrelloShortLink("https://trello.com/b/AbCd1234/my-board")).toBe(
      "AbCd1234",
    );
    expect(parseTrelloShortLink("https://trello.com/b/AbCd1234")).toBe(
      "AbCd1234",
    );
    expect(parseTrelloShortLink("trello.com/b/xY9zAAaa.json")).toBe("xY9zAAaa");
  });

  it("rejects non-board / non-trello URLs", () => {
    expect(parseTrelloShortLink("https://trello.com/c/xxxx/1-card")).toBeNull();
    expect(parseTrelloShortLink("https://example.com/b/AbCd1234")).toBeNull();
    expect(parseTrelloShortLink("")).toBeNull();
    // @ts-expect-error deliberately wrong type
    expect(parseTrelloShortLink(null)).toBeNull();
  });
});

describe("checklistToMarkdown", () => {
  it("renders a Markdown task list with checked state, ordered by pos", () => {
    const md = checklistToMarkdown("Todo", [
      { name: "second", state: "incomplete", pos: 2 },
      { name: "first", state: "complete", pos: 1 },
    ]);
    expect(md).toContain("**Todo**");
    // ordered by pos: the complete "first" comes before "second"
    expect(md.indexOf("first")).toBeLessThan(md.indexOf("second"));
    expect(md).toContain("- [x] first");
    expect(md).toContain("- [ ] second");
  });
});

describe("linkAttachmentsToMarkdown", () => {
  it("renders only link attachments (uploads are excluded) as Markdown links", () => {
    expect(linkAttachmentsToMarkdown([])).toBe("");
    const md = linkAttachmentsToMarkdown([
      {
        name: "Blog post",
        url: "https://blog.example.com/x",
        pos: 1,
        isUpload: false,
      },
      {
        name: "photo.png",
        url: "https://trello.com/1/cards/x/download/photo.png",
        pos: 2,
        isUpload: true,
      },
    ]);
    expect(md).toContain("**Links**");
    expect(md).toContain("- [Blog post](https://blog.example.com/x)");
    // an uploaded file is not a link — it's downloaded/re-hosted instead
    expect(md).not.toContain("photo.png");
  });
});

describe("trelloJsonToBoard", () => {
  it("returns null for non-board payloads", () => {
    expect(trelloJsonToBoard(null)).toBeNull();
    expect(trelloJsonToBoard("<html>login</html>")).toBeNull();
    expect(trelloJsonToBoard({ name: "x" })).toBeNull();
  });

  it("maps lists/cards, skips closed, orders by pos, merges checklists, attachments, comments", () => {
    const board = trelloJsonToBoard({
      name: "My Board",
      lists: [
        { id: "l2", name: "Second", pos: 2 },
        { id: "l1", name: "First", pos: 1 },
        { id: "l3", name: "Archived", pos: 3, closed: true },
      ],
      cards: [
        {
          id: "c1",
          idList: "l1",
          name: "Card B",
          pos: 2,
          desc: "",
          dueComplete: true,
        },
        {
          id: "c2",
          idList: "l1",
          name: "Card A",
          pos: 1,
          desc: "**bold**",
          attachments: [
            {
              name: "Doc",
              url: "https://example.com/doc",
              pos: 1,
              isUpload: false,
            },
            {
              name: "pic.png",
              url: "https://trello.com/1/cards/c2/download/pic.png",
              pos: 2,
              isUpload: true,
              mimeType: null,
              bytes: 1234,
            },
          ],
        },
        { id: "c3", idList: "l1", name: "Gone", pos: 3, closed: true },
      ],
      checklists: [
        {
          idCard: "c2",
          name: "Steps",
          pos: 1,
          checkItems: [{ name: "do it", state: "complete", pos: 1 }],
        },
      ],
      actions: [
        {
          type: "commentCard",
          date: "2024-01-02T00:00:00.000Z",
          data: { text: "second comment", card: { id: "c2" } },
          memberCreator: { fullName: "Jane Doe" },
        },
        {
          type: "commentCard",
          date: "2024-01-01T00:00:00.000Z",
          data: { text: "first comment", card: { id: "c2" } },
          memberCreator: { username: "john" },
        },
        { type: "updateCard", data: { card: { id: "c2" } } },
      ],
    });

    expect(board).not.toBeNull();
    expect(board!.name).toBe("My Board");
    // closed list dropped, remaining ordered by pos
    expect(board!.areas.map((a) => a.name)).toEqual(["First", "Second"]);

    const first = board!.areas[0];
    // closed card dropped, remaining ordered by pos (Card A before Card B)
    expect(first.cards.map((c) => c.name)).toEqual(["Card A", "Card B"]);
    const cardA = first.cards[0];
    const cardB = first.cards[1];
    // description + checklist + LINK attachment, as Markdown
    expect(cardA.content).toContain("**bold**");
    expect(cardA.content).toContain("**Steps**");
    expect(cardA.content).toContain("- [x] do it");
    expect(cardA.content).toContain("[Doc](https://example.com/doc)");
    // the uploaded file is NOT in the description — it's queued for download
    expect(cardA.content).not.toContain("pic.png");
    expect(cardA.attachments.map((a) => a.name)).toEqual(["pic.png"]);
    expect(cardA.attachments[0].bytes).toBe(1234);
    // Trello completion flag → card status
    expect(cardA.status).toBe(0);
    expect(cardB.status).toBe(1);
    // comments imported (non-comment actions ignored), ordered oldest-first,
    // author name preserved
    expect(cardA.comments.map((c) => c.authorName)).toEqual(["john", "Jane Doe"]);
    expect(cardA.comments[0].content).toContain("first comment");
    expect(cardA.comments[1].date).toBe("2024-01-02T00:00:00.000Z");
  });

  it("falls back to a default board name", () => {
    const board = trelloJsonToBoard({ lists: [], cards: [] });
    expect(board!.name).toBe("Trello import");
    expect(board!.areas).toEqual([]);
  });

  it("resolves a comment author's full name from the board members list", () => {
    const board = trelloJsonToBoard({
      name: "B",
      lists: [{ id: "l1", name: "L", pos: 1 }],
      cards: [{ id: "c1", idList: "l1", name: "C", pos: 1 }],
      members: [{ id: "m1", fullName: "Florian Straßer", username: "kontakt" }],
      actions: [
        {
          type: "commentCard",
          date: "2024-01-01T00:00:00.000Z",
          idMemberCreator: "m1",
          data: { text: "hi", card: { id: "c1" } },
          // the action snapshot only carries the @username, no full name
          memberCreator: { username: "kontakt" },
        },
      ],
    });
    expect(board!.areas[0].cards[0].comments[0].authorName).toBe(
      "Florian Straßer",
    );
  });
});

// ---------------------------------------------------------------------------
// Trello's exported file, and what the import does with its links.

import fs from "node:fs";
import { isTrelloExport, trelloToImport } from "../server/utils/trelloImport";
import { isWekanExport } from "../server/utils/wekanImport";
import { isDeckExport } from "../server/utils/deckImport";
import { isTrelloAttachmentUrl } from "../server/utils/trelloDownload";
import { filesAsLinks } from "../server/utils/boardImport";

const fixture = (name: string) =>
  JSON.parse(fs.readFileSync(new URL(`./fixtures/import/${name}`, import.meta.url), "utf8"));

// The fields Trello's export has at the top — the same as a public board's JSON.
const trelloBoard = {
  id: "5f0000000000000000000001",
  name: "Launch",
  shortLink: "AbCd1234",
  lists: [{ id: "l1", name: "To do", pos: 1, closed: false }],
  cards: [
    {
      id: "c1",
      idList: "l1",
      name: "Pick a date",
      desc: "",
      pos: 1,
      closed: false,
      due: "2026-10-01T10:00:00.000Z",
      dueComplete: false,
      labels: [
        { id: "a", name: "Marketing", color: "green" },
        { id: "b", name: "", color: "red" },
      ],
      attachments: [
        {
          id: "f1",
          name: "plan.pdf",
          isUpload: true,
          mimeType: "application/pdf",
          bytes: 1200,
          url: "https://trello.com/1/cards/c1/attachments/f1/download/plan.pdf",
        },
      ],
    },
  ],
  checklists: [],
  actions: [],
  members: [],
};

describe("isTrelloExport", () => {
  it("recognises Trello's board export, and tells it from Wekan's and Deck's", () => {
    expect(isTrelloExport(trelloBoard)).toBe(true);
    expect(isTrelloExport(fixture("wekan-board.json"))).toBe(false);
    expect(isTrelloExport(fixture("deck-export.json"))).toBe(false);
    expect(isWekanExport(trelloBoard)).toBe(false);
    expect(isDeckExport(trelloBoard)).toBe(false);
  });
});

describe("trelloToImport", () => {
  const card = trelloToImport(trelloBoard)!.areas[0].cards[0];

  it("brings the labels, a colour-only one by its colour, and the due date", () => {
    expect(card.labels).toEqual(["Marketing", "red"]);
    expect(card.dueDate).toBe("2026-10-01T10:00:00.000Z");
    expect(card.done).toBe(false);
  });

  it("keeps an uploaded file as a link to fetch", () => {
    expect(card.files).toEqual([
      {
        name: "plan.pdf",
        type: "application/pdf",
        url: "https://trello.com/1/cards/c1/attachments/f1/download/plan.pdf",
        bytes: 1200,
      },
    ]);
  });
});

describe("isTrelloAttachmentUrl", () => {
  it("is only ever an attachment download on trello.com, over https", () => {
    expect(isTrelloAttachmentUrl("https://trello.com/1/cards/c1/attachments/f1/download/plan.pdf")).toBe(true);
    expect(isTrelloAttachmentUrl("http://trello.com/1/cards/c1/attachments/f1/download/plan.pdf")).toBe(false);
    expect(isTrelloAttachmentUrl("https://trello.com.evil.example/1/cards/c1/attachments/f1/download/x")).toBe(false);
    expect(isTrelloAttachmentUrl("https://evil.example/1/cards/c1/attachments/f1/download/x")).toBe(false);
    expect(isTrelloAttachmentUrl("https://trello.com/b/AbCd1234.json")).toBe(false);
    expect(isTrelloAttachmentUrl("https://user@trello.com:8443/1/cards/c1/attachments/f1/download/x")).toBe(false);
    expect(isTrelloAttachmentUrl(null)).toBe(false);
  });
});

describe("filesAsLinks", () => {
  it("lists the files left behind as Markdown links, names and addresses made safe", () => {
    expect(
      filesAsLinks("Attachments that could not be copied", [
        { name: "plan [v2].pdf", type: "", url: "https://trello.com/1/cards/c/attachments/f/download/plan (v2).pdf" },
        { name: "no link", type: "", data: "AA==" },
      ]),
    ).toBe(
      "**Attachments that could not be copied**\n\n" +
        "- [plan \\[v2\\].pdf](https://trello.com/1/cards/c/attachments/f/download/plan%20%28v2%29.pdf)",
    );
  });
});
