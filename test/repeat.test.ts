import { describe, it, expect } from "vitest";
import {
  isRepeatEvery,
  nextOccurrence,
  occurrence,
  repeatAfterEdit,
  untickChecklist,
} from "../server/utils/repeat";

// Dates are built from their parts on the local clock, which is the clock the
// server counts on, so these read the same in any time zone.
const at = (y: number, m: number, d: number, h = 9, min = 0) =>
  new Date(y, m - 1, d, h, min);
const parts = (date: Date) => [
  date.getFullYear(),
  date.getMonth() + 1,
  date.getDate(),
  date.getHours(),
  date.getMinutes(),
];

describe("occurrence", () => {
  it("steps days and weeks on the calendar", () => {
    expect(parts(occurrence(at(2026, 9, 21), "day", 1))).toEqual([2026, 9, 22, 9, 0]);
    expect(parts(occurrence(at(2026, 9, 21), "week", 2))).toEqual([2026, 10, 5, 9, 0]);
    expect(parts(occurrence(at(2026, 9, 21), "twoWeeks", 1))).toEqual([2026, 10, 5, 9, 0]);
  });

  it("keeps the time of day across a change to or from summer time", () => {
    // Late October and late March are when most of Europe changes its clocks.
    expect(parts(occurrence(at(2026, 10, 19, 9, 30), "week", 1))).toEqual([2026, 10, 26, 9, 30]);
    expect(parts(occurrence(at(2027, 3, 22, 9, 30), "week", 1))).toEqual([2027, 3, 29, 9, 30]);
  });

  it("keeps the day of the month, and falls back to the last day where there is no such day", () => {
    expect(parts(occurrence(at(2026, 1, 15), "month", 1))).toEqual([2026, 2, 15, 9, 0]);
    expect(parts(occurrence(at(2026, 1, 30), "month", 1))).toEqual([2026, 2, 28, 9, 0]);
    // Counted from the anchor, so February does not drag March down with it.
    expect(parts(occurrence(at(2026, 1, 30), "month", 2))).toEqual([2026, 3, 30, 9, 0]);
  });

  it("keeps a card on the last day of the month on the last day", () => {
    expect(parts(occurrence(at(2026, 1, 31), "month", 1))).toEqual([2026, 2, 28, 9, 0]);
    expect(parts(occurrence(at(2026, 1, 31), "month", 3))).toEqual([2026, 4, 30, 9, 0]);
    expect(parts(occurrence(at(2026, 4, 30), "month", 1))).toEqual([2026, 5, 31, 9, 0]);
  });

  it("moves a year, and 29 February to the end of February", () => {
    expect(parts(occurrence(at(2026, 9, 21), "year", 1))).toEqual([2027, 9, 21, 9, 0]);
    expect(parts(occurrence(at(2028, 2, 29), "year", 1))).toEqual([2029, 2, 28, 9, 0]);
    expect(parts(occurrence(at(2028, 2, 29), "year", 4))).toEqual([2032, 2, 29, 9, 0]);
  });

  it("does not spill into the following month when the month changes", () => {
    // Setting the month on a date of the 31st would roll into the next one.
    expect(parts(occurrence(at(2026, 3, 31), "month", 1))).toEqual([2026, 4, 30, 9, 0]);
  });
});

describe("nextOccurrence", () => {
  it("is the next date after the card's own when it is done early", () => {
    const due = at(2026, 9, 28);
    expect(parts(nextOccurrence(due, "week", due))).toEqual([2026, 10, 5, 9, 0]);
  });

  it("skips the dates that have gone by when it is done late", () => {
    const anchor = at(2026, 9, 1);
    const now = at(2026, 9, 17, 12);
    expect(parts(nextOccurrence(anchor, "week", now))).toEqual([2026, 9, 22, 9, 0]);
  });

  it("counts from the anchor, not from the card before", () => {
    // The series was set on the 30th; February's card was due on the 28th.
    const anchor = at(2026, 1, 30);
    expect(parts(nextOccurrence(anchor, "month", at(2026, 2, 28)))).toEqual([2026, 3, 30, 9, 0]);
  });
});

describe("untickChecklist", () => {
  it("unticks every kind of task item", () => {
    const before = "Weekly\n\n- [x] one\n- [X] two\n* [ ] three\n1. [x] four\n  - [x] nested";
    const after = "Weekly\n\n- [ ] one\n- [ ] two\n* [ ] three\n1. [ ] four\n  - [ ] nested";
    expect(untickChecklist(before)).toBe(after);
  });

  it("leaves code blocks and ordinary text alone", () => {
    const text = "Say [x] in a sentence.\n```\n- [x] an example\n```\n- [x] real";
    expect(untickChecklist(text)).toBe(
      "Say [x] in a sentence.\n```\n- [x] an example\n```\n- [ ] real",
    );
  });
});

describe("repeatAfterEdit", () => {
  const due = at(2026, 9, 28);
  const card = { area: 4 };

  it("switching it on anchors the series on the due date and the current column", () => {
    expect(repeatAfterEdit(card, "week", due, false)).toEqual({
      repeatEvery: "week",
      repeatAnchor: due,
      repeatArea: 4,
    });
  });

  it("is off without a due date, or when asked to stop", () => {
    const on = { area: 4, repeatEvery: "week", repeatAnchor: due, repeatArea: 4 };
    const off = { repeatEvery: null, repeatAnchor: null, repeatArea: null };
    expect(repeatAfterEdit(on, undefined, null, true)).toEqual(off);
    expect(repeatAfterEdit(on, null, due, false)).toEqual(off);
    expect(repeatAfterEdit(on, "", due, false)).toEqual(off);
    expect(repeatAfterEdit(card, "fortnightly-ish", due, false)).toEqual(off);
  });

  it("leaves the series alone on an edit that does not touch it", () => {
    const anchor = at(2026, 1, 31);
    const on = { area: 9, repeatEvery: "month", repeatAnchor: anchor, repeatArea: 4 };
    expect(repeatAfterEdit(on, undefined, at(2026, 2, 28), false)).toEqual({
      repeatEvery: "month",
      repeatAnchor: anchor,
      repeatArea: 4,
    });
  });

  it("follows the due date when it is moved by hand", () => {
    const on = { area: 4, repeatEvery: "week", repeatAnchor: at(2026, 9, 21), repeatArea: 4 };
    const moved = at(2026, 9, 29);
    expect(repeatAfterEdit(on, undefined, moved, true).repeatAnchor).toEqual(moved);
  });

  it("knows the rhythms it accepts", () => {
    expect(["day", "week", "twoWeeks", "month", "year"].every(isRepeatEvery)).toBe(true);
    expect(isRepeatEvery("hour")).toBe(false);
  });
});
