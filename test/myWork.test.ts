import { describe, it, expect } from "vitest";
import { groupMyWork } from "../app/utils/myWork";

// A Wednesday, at noon, in whatever timezone the tests run in: the grouping
// works in local time, the same as the person looking at the dashboard.
const NOW = new Date(2026, 8, 16, 12, 0);
const at = (days: number, hours: number, minutes = 0) =>
  new Date(2026, 8, 16 + days, hours, minutes).toISOString();

const names = (groups: ReturnType<typeof groupMyWork>) =>
  Object.fromEntries(groups.map((g) => [g.key, g.cards.map((c: any) => c.name)]));

describe("groupMyWork", () => {
  it("puts what is already late in overdue, including earlier today", () => {
    const groups = groupMyWork(
      [
        { name: "yesterday", dueDate: at(-1, 9) },
        { name: "this morning", dueDate: at(0, 9) },
      ],
      NOW,
    );
    expect(names(groups)).toEqual({ overdue: ["yesterday", "this morning"] });
  });

  it("counts the rest of today and the six days after it as this week", () => {
    const groups = groupMyWork(
      [
        { name: "tonight", dueDate: at(0, 18) },
        { name: "last minute of the window", dueDate: at(6, 23, 59) },
      ],
      NOW,
    );
    expect(names(groups)).toEqual({
      week: ["tonight", "last minute of the window"],
    });
  });

  it("starts later at midnight seven days from today, the filter's own boundary", () => {
    const groups = groupMyWork([{ name: "next week", dueDate: at(7, 0) }], NOW);
    expect(names(groups)).toEqual({ later: ["next week"] });
  });

  it("puts a card with no date, or a date it cannot read, in later, after the dated ones", () => {
    const groups = groupMyWork(
      [
        { name: "someday" },
        { name: "garbled", dueDate: "not a date" },
        { name: "in a month", dueDate: at(30, 9) },
      ],
      NOW,
    );
    expect(names(groups)).toEqual({ later: ["in a month", "someday", "garbled"] });
  });

  it("orders each group earliest first, whatever order the cards came in", () => {
    const groups = groupMyWork(
      [
        { name: "Friday", dueDate: at(2, 9) },
        { name: "Thursday", dueDate: at(1, 9) },
        { name: "last week", dueDate: at(-7, 9) },
        { name: "two days ago", dueDate: at(-2, 9) },
      ],
      NOW,
    );
    expect(names(groups)).toEqual({
      overdue: ["last week", "two days ago"],
      week: ["Thursday", "Friday"],
    });
  });

  it("always lists the groups in the same order and leaves empty ones out", () => {
    const groups = groupMyWork(
      [{ name: "undated" }, { name: "late", dueDate: at(-1, 9) }],
      NOW,
    );
    expect(groups.map((g) => g.key)).toEqual(["overdue", "later"]);
    expect(groupMyWork([], NOW)).toEqual([]);
  });

  it("does not reorder the list it was given", () => {
    const cards = [
      { name: "b", dueDate: at(2, 9) },
      { name: "a", dueDate: at(1, 9) },
    ];
    groupMyWork(cards, NOW);
    expect(cards.map((c) => c.name)).toEqual(["b", "a"]);
  });
});
