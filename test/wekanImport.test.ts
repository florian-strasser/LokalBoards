import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { isWekanExport, wekanJsonToBoard } from "../server/utils/wekanImport";
import { boardLabelNames } from "../server/utils/boardImport";

// A real export from a real Wekan — see test/fixtures/import/README.md.
const fixture = JSON.parse(
  fs.readFileSync(new URL("./fixtures/import/wekan-board.json", import.meta.url), "utf8"),
);

describe("isWekanExport", () => {
  it("recognises Wekan's board export, and nothing else", () => {
    expect(isWekanExport(fixture)).toBe(true);
    expect(isWekanExport({ lists: [], cards: [] })).toBe(false);
    expect(isWekanExport({ _format: "trello", lists: [], cards: [] })).toBe(false);
    expect(isWekanExport(null)).toBe(false);
  });
});

describe("wekanJsonToBoard", () => {
  const board = wekanJsonToBoard(fixture)!;
  const card = (name: string) =>
    board.areas.flatMap((area) => area.cards).find((c) => c.name === name)!;

  it("keeps the board's name and its lists in order", () => {
    expect(board.name).toBe("Website Relaunch");
    expect(board.areas.map((area) => area.name)).toEqual(["To do", "In progress", "Done"]);
  });

  it("puts each card in its list, in order, and leaves the archived one behind", () => {
    expect(board.areas.map((area) => area.cards.map((c) => c.name))).toEqual([
      ["Redesign the header", "Fix the contact form"],
      ["Write the launch post"],
      ["Choose a font"],
    ]);
  });

  it("keeps the description as Markdown and adds the checklist under it", () => {
    expect(card("Redesign the header").content).toBe(
      "Make the header **sticky** on scroll.\n\nSee the [mockup](https://example.test/mockup).\n\n" +
        "**Steps**\n\n- [x] Collect references\n- [ ] First draft\n- [ ] Review",
    );
    expect(card("Fix the contact form").content).toBe('It sends twice — "Größe" breaks it.');
  });

  it("brings the due date, the labels, and done when the due date was completed", () => {
    expect(card("Redesign the header")).toMatchObject({
      dueDate: "2026-10-15T09:00:00.000Z",
      labels: ["Design", "Bug"],
      done: false,
    });
    expect(card("Choose a font")).toMatchObject({ done: true, dueDate: "2026-09-18T15:00:00.000Z" });
  });

  it("keeps the comments in order, by name", () => {
    expect(card("Redesign the header").comments.map((c) => [c.authorName, c.content])).toEqual([
      ["florian", "Looks **good** so far."],
      ["anna", "I'll take the review."],
    ]);
  });

  it("carries the attached files, bytes and all", () => {
    const files = card("Redesign the header").files;
    expect(files.map((f) => [f.name, f.type])).toEqual([
      ["sketch.png", "image/png"],
      ["notes.txt", "text/plain"],
    ]);
    expect(Buffer.from(files[1].data, "base64").toString("utf8")).toBe("Größen: 12px, 16px\n");
  });

  it("names a label that is only a colour after its colour", () => {
    const colours = wekanJsonToBoard({
      ...fixture,
      labels: [{ _id: "c1", name: "", color: "orange" }],
      cards: [{ ...fixture.cards[0], labelIds: ["c1"], archived: false }],
    })!;
    expect(colours.areas[0].cards[0].labels).toEqual(["orange"]);
  });
});

describe("boardLabelNames", () => {
  it("is each word once, whatever its case, and no more than thirty", () => {
    const many = Array.from({ length: 40 }, (_, i) => `L${i}`);
    const names = boardLabelNames({
      name: "x",
      areas: [
        {
          name: "a",
          cards: [
            { name: "c", content: "", done: false, dueDate: null, labels: ["Bug", "bug", " Design "], comments: [], files: [] },
            { name: "d", content: "", done: false, dueDate: null, labels: many, comments: [], files: [] },
          ],
        },
      ],
    });
    expect(names.slice(0, 2)).toEqual(["Bug", "Design"]);
    expect(names).toHaveLength(30);
  });
});
