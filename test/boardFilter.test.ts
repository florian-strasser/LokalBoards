import { describe, it, expect } from "vitest";
import {
  EMPTY_FILTER,
  UNASSIGNED,
  assigneesOf,
  isFiltering,
  matchesFilter,
  type BoardFilter,
} from "../app/utils/boardFilter";

// A Wednesday, mid-afternoon, so "today" has hours on either side of `now` and
// the week window has to be reasoned about rather than guessed.
const NOW = new Date(2026, 8, 9, 15, 0, 0);
const at = (...args: number[]) => new Date(...(args as [number, number, number])).toISOString();

const filter = (over: Partial<BoardFilter> = {}): BoardFilter => ({
  ...EMPTY_FILTER,
  ...over,
});
const card = (over: any = {}) => ({
  id: 1,
  status: 0,
  assignee: null,
  dueDate: null,
  labels: [],
  ...over,
});

describe("isFiltering", () => {
  it("is false for the empty filter", () => {
    expect(isFiltering(EMPTY_FILTER)).toBe(false);
  });

  it("is true as soon as any part is set", () => {
    expect(isFiltering(filter({ labels: [1] }))).toBe(true);
    expect(isFiltering(filter({ assignees: ["u"] }))).toBe(true);
    expect(isFiltering(filter({ due: "overdue" }))).toBe(true);
    expect(isFiltering(filter({ done: false }))).toBe(true);
  });

  it("counts 'open' as a filter, since false is a choice", () => {
    expect(isFiltering(filter({ done: false }))).toBe(true);
  });
});

describe("matchesFilter", () => {
  it("lets everything through when nothing is set", () => {
    expect(matchesFilter(card(), EMPTY_FILTER, NOW)).toBe(true);
  });

  it("matches a card wearing any one of the chosen labels", () => {
    const wanted = filter({ labels: [1, 2] });
    expect(matchesFilter(card({ labels: [{ id: 2 }] }), wanted, NOW)).toBe(true);
    expect(matchesFilter(card({ labels: [{ id: 3 }] }), wanted, NOW)).toBe(false);
    expect(matchesFilter(card({ labels: [] }), wanted, NOW)).toBe(false);
  });

  it("matches an assignee, and 'nobody' for an unassigned card", () => {
    expect(
      matchesFilter(card({ assignee: "u1" }), filter({ assignees: ["u1"] }), NOW),
    ).toBe(true);
    expect(
      matchesFilter(card({ assignee: "u2" }), filter({ assignees: ["u1"] }), NOW),
    ).toBe(false);
    expect(
      matchesFilter(card(), filter({ assignees: [UNASSIGNED] }), NOW),
    ).toBe(true);
    expect(
      matchesFilter(card({ assignee: "u1" }), filter({ assignees: [UNASSIGNED] }), NOW),
    ).toBe(false);
  });

  it("tells open from done", () => {
    expect(matchesFilter(card({ status: 1 }), filter({ done: true }), NOW)).toBe(true);
    expect(matchesFilter(card({ status: 0 }), filter({ done: true }), NOW)).toBe(false);
    expect(matchesFilter(card({ status: 0 }), filter({ done: false }), NOW)).toBe(true);
    expect(matchesFilter(card({ status: 1 }), filter({ done: false }), NOW)).toBe(false);
  });

  describe("due dates", () => {
    it("counts anything before now as overdue", () => {
      const wanted = filter({ due: "overdue" });
      expect(matchesFilter(card({ dueDate: at(2026, 8, 9, 14) }), wanted, NOW)).toBe(true);
      expect(matchesFilter(card({ dueDate: at(2026, 8, 9, 16) }), wanted, NOW)).toBe(false);
      expect(matchesFilter(card(), wanted, NOW)).toBe(false);
    });

    it("counts the whole of today as today, either side of the hour", () => {
      const wanted = filter({ due: "today" });
      expect(matchesFilter(card({ dueDate: at(2026, 8, 9, 8) }), wanted, NOW)).toBe(true);
      expect(matchesFilter(card({ dueDate: at(2026, 8, 9, 23) }), wanted, NOW)).toBe(true);
      expect(matchesFilter(card({ dueDate: at(2026, 8, 10, 0) }), wanted, NOW)).toBe(false);
      expect(matchesFilter(card({ dueDate: at(2026, 8, 8, 23) }), wanted, NOW)).toBe(false);
    });

    it("looks forward a week, and not backwards", () => {
      const wanted = filter({ due: "week" });
      expect(matchesFilter(card({ dueDate: at(2026, 8, 9, 8) }), wanted, NOW)).toBe(true);
      expect(matchesFilter(card({ dueDate: at(2026, 8, 15, 23) }), wanted, NOW)).toBe(true);
      expect(matchesFilter(card({ dueDate: at(2026, 8, 16, 0) }), wanted, NOW)).toBe(false);
      // Late is a different question from upcoming, and has its own filter.
      expect(matchesFilter(card({ dueDate: at(2026, 8, 1, 8) }), wanted, NOW)).toBe(false);
    });

    it("finds the cards with no due date at all", () => {
      const wanted = filter({ due: "none" });
      expect(matchesFilter(card(), wanted, NOW)).toBe(true);
      expect(matchesFilter(card({ dueDate: at(2026, 8, 9, 8) }), wanted, NOW)).toBe(false);
    });

    it("does not match a card whose due date is unreadable", () => {
      expect(
        matchesFilter(card({ dueDate: "not a date" }), filter({ due: "overdue" }), NOW),
      ).toBe(false);
    });
  });

  it("combines the parts with and", () => {
    const wanted = filter({ labels: [1], done: false });
    expect(
      matchesFilter(card({ labels: [{ id: 1 }], status: 0 }), wanted, NOW),
    ).toBe(true);
    // Right label, wrong state.
    expect(
      matchesFilter(card({ labels: [{ id: 1 }], status: 1 }), wanted, NOW),
    ).toBe(false);
  });
});

describe("assigneesOf", () => {
  it("offers each person once, by name", () => {
    const people = assigneesOf(
      [
        card({ assignee: "u2", assigneeName: "Zoe" }),
        card({ assignee: "u1", assigneeName: "Ada" }),
        card({ assignee: "u1", assigneeName: "Ada" }),
      ],
      "Unassigned",
    );
    expect(people.map((p) => p.name)).toEqual(["Ada", "Zoe"]);
  });

  it("adds 'nobody' only when some card has no assignee", () => {
    expect(
      assigneesOf([card({ assignee: "u1", assigneeName: "Ada" })], "Unassigned"),
    ).toHaveLength(1);

    const withNobody = assigneesOf(
      [card({ assignee: "u1", assigneeName: "Ada" }), card()],
      "Unassigned",
    );
    expect(withNobody.at(-1)).toMatchObject({ id: UNASSIGNED, name: "Unassigned" });
  });

  it("offers nobody from an empty board as nothing at all", () => {
    expect(assigneesOf([], "Unassigned")).toEqual([]);
  });
});
