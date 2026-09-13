import { describe, it, expect } from "vitest";
import {
  EMPTY_FILTER,
  UNASSIGNED,
  filterFromQuery,
  filterToQuery,
  sameFilter,
  sameQuery,
  withFilterQuery,
} from "../app/utils/boardFilter";

// A filtered board is a link. These pin what goes into the address and what
// comes back out of it, including out of an address somebody typed.

const FULL = {
  labels: [3, 7],
  assignees: ["0b6c3c1e-8f1c-4c55-9f3f-2a1d8f0e9a11", UNASSIGNED],
  due: "overdue",
  done: false,
};

describe("filterToQuery", () => {
  it("says nothing at all for a board that is not filtered", () => {
    expect(filterToQuery(EMPTY_FILTER)).toEqual({});
  });

  it("writes every part as one short parameter", () => {
    expect(filterToQuery(FULL)).toEqual({
      labels: "3,7",
      assignee: "0b6c3c1e-8f1c-4c55-9f3f-2a1d8f0e9a11,none",
      due: "overdue",
      status: "open",
    });
  });

  it("writes done as done", () => {
    expect(filterToQuery({ ...EMPTY_FILTER, done: true })).toEqual({
      status: "done",
    });
  });
});

describe("filterFromQuery", () => {
  it("reads back exactly what it wrote", () => {
    expect(filterFromQuery(filterToQuery(FULL))).toEqual(FULL);
    expect(filterFromQuery(filterToQuery(EMPTY_FILTER))).toEqual(EMPTY_FILTER);
  });

  it("reads no parameters as no filter", () => {
    expect(filterFromQuery({})).toEqual(EMPTY_FILTER);
    expect(filterFromQuery({ card: "12", comment: "4" })).toEqual(EMPTY_FILTER);
  });

  it("keeps the good values of a hand-typed address and drops the rest", () => {
    expect(
      filterFromQuery({
        labels: "3,abc,-1,0,2.5, 7 ,3",
        due: "soon",
        status: "maybe",
      }),
    ).toEqual({ ...EMPTY_FILTER, labels: [3, 7] });
  });

  it("takes a parameter given twice as well as a list", () => {
    expect(filterFromQuery({ labels: ["3", "7"], assignee: ["none"] })).toEqual({
      ...EMPTY_FILTER,
      labels: [3, 7],
      assignees: [UNASSIGNED],
    });
  });

  it("takes the first usable due value and ignores empty ones", () => {
    expect(filterFromQuery({ due: "later,week,today" }).due).toBe("week");
    expect(filterFromQuery({ labels: "", assignee: ",," })).toEqual(EMPTY_FILTER);
  });

  it("refuses an assignee too long to be an account", () => {
    expect(filterFromQuery({ assignee: "x".repeat(300) }).assignees).toEqual([]);
  });
});

describe("withFilterQuery", () => {
  it("keeps the open card and replaces only the filter's parameters", () => {
    expect(
      withFilterQuery(
        { card: "12", comment: "4", labels: "1", due: "today" },
        { ...EMPTY_FILTER, labels: [9] },
      ),
    ).toEqual({ card: "12", comment: "4", labels: "9" });
  });

  it("removes the filter from the address when it is cleared", () => {
    expect(
      withFilterQuery({ card: "12", labels: "1", status: "done" }, EMPTY_FILTER),
    ).toEqual({ card: "12" });
  });
});

describe("sameFilter and sameQuery", () => {
  it("treat the same filter as the same, however it was built", () => {
    expect(
      sameFilter(filterFromQuery({ labels: "3,7" }), { ...EMPTY_FILTER, labels: [3, 7] }),
    ).toBe(true);
    expect(sameFilter(EMPTY_FILTER, { ...EMPTY_FILTER, done: true })).toBe(false);
  });

  it("ignore the order the keys are in", () => {
    expect(sameQuery({ card: "1", labels: "3" }, { labels: "3", card: "1" })).toBe(true);
    expect(sameQuery({ card: "1" }, { card: "2" })).toBe(false);
  });
});
