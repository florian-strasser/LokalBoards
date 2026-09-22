import { describe, it, expect } from "vitest";
import {
  assigneeIdsFrom,
  diffAssignees,
  withAssignees,
} from "../server/utils/cardAssignees";

describe("diffAssignees", () => {
  it("says who came on and who went off, in the order given", () => {
    expect(diffAssignees(["a", "b"], ["b", "c", "d"])).toEqual({
      added: ["c", "d"],
      removed: ["a"],
    });
  });

  it("is nothing for the same people", () => {
    expect(diffAssignees(["a", "b"], ["b", "a"])).toEqual({ added: [], removed: [] });
  });
});

describe("assigneeIdsFrom", () => {
  it("keeps strings, each once, in order", () => {
    expect(assigneeIdsFrom(["b", " a ", "b", 7, null, "", "x".repeat(256)])).toEqual([
      "b",
      "a",
    ]);
  });

  it("reads anything that is not a list as nobody", () => {
    expect(assigneeIdsFrom("a")).toEqual([]);
    expect(assigneeIdsFrom(undefined)).toEqual([]);
  });
});

describe("withAssignees", () => {
  it("puts everyone on the card, and the first of them in the older fields", () => {
    const card = withAssignees({ id: 1 }, [
      { id: "u1", name: "Ada", image: "/a.webp", type: "human" },
      { id: "u2", name: "Bot", image: null, type: "artificial" },
    ]);
    expect(card.assignees).toHaveLength(2);
    expect(card).toMatchObject({
      assignee: "u1",
      assigneeName: "Ada",
      assigneeImage: "/a.webp",
      assigneeType: "human",
    });
  });

  it("says nobody in both when nobody is on it", () => {
    expect(withAssignees({ id: 1 }, [])).toMatchObject({
      assignees: [],
      assignee: null,
      assigneeName: null,
    });
  });
});
