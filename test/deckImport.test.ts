import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { deckJsonToBoards, isDeckExport } from "../server/utils/deckImport";
import { isWekanExport } from "../server/utils/wekanImport";

// A real export from a real Nextcloud Deck — see test/fixtures/import/README.md.
const fixture = JSON.parse(
  fs.readFileSync(new URL("./fixtures/import/deck-export.json", import.meta.url), "utf8"),
);
const wekan = JSON.parse(
  fs.readFileSync(new URL("./fixtures/import/wekan-board.json", import.meta.url), "utf8"),
);

describe("isDeckExport", () => {
  it("recognises Deck's export, and tells it from Wekan's", () => {
    expect(isDeckExport(fixture)).toBe(true);
    expect(isDeckExport(wekan)).toBe(false);
    expect(isWekanExport(fixture)).toBe(false);
    expect(isDeckExport({ version: "1.19.0", boards: {} })).toBe(false);
  });
});

describe("deckJsonToBoards", () => {
  const boards = deckJsonToBoards(fixture)!;
  const relaunch = boards.find((board) => board.name === "Website Relaunch")!;
  const card = (name: string) =>
    relaunch.areas.flatMap((area) => area.cards).find((c) => c.name === name)!;

  it("brings every board in the file, each on its own", () => {
    expect(boards.map((board) => board.name)).toEqual([
      "Welcome to Nextcloud Deck!",
      "Website Relaunch",
    ]);
  });

  it("keeps the stacks and their cards in order", () => {
    expect(relaunch.areas.map((area) => [area.name, area.cards.map((c) => c.name)])).toEqual([
      ["To do", ["Redesign the header", "Fix the contact form"]],
      ["In progress", ["Write the launch post"]],
      ["Done", ["Choose a font"]],
    ]);
  });

  it("keeps the description, checklist and all, as Markdown", () => {
    expect(card("Redesign the header").content).toBe(
      "Make the header **sticky** on scroll.\n\n- [x] Collect references\n- [ ] First draft\n- [ ] Review",
    );
  });

  it("brings the due date, the labels, and done from the done date", () => {
    expect(card("Redesign the header")).toMatchObject({
      dueDate: "2026-10-15T09:00:00+00:00",
      labels: ["Action needed", "Design"],
      done: false,
    });
    expect(card("Choose a font").done).toBe(true);
  });

  it("keeps the comments in the order they were written, by display name", () => {
    expect(card("Redesign the header").comments.map((c) => [c.authorName, c.content])).toEqual([
      ["florian", "Looks **good** so far."],
      ["Anna Müller", "I'll take the review."],
    ]);
  });

  it("has no files to bring, because the export has none", () => {
    expect(relaunch.areas.flatMap((area) => area.cards).every((c) => c.files.length === 0)).toBe(true);
  });
});
