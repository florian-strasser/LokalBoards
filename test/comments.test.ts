import { describe, it, expect } from "vitest";
import { uniqueComments, withComment } from "../app/utils/comments";

// A comment reaching the open card twice — your own POST and the socket event
// for the same comment — must not show up twice.

const comment = (id: number | string, content = "hello") => ({ id, content });

describe("withComment", () => {
  it("adds a comment that is not there yet, newest first", () => {
    expect(withComment([comment(1)], comment(2)).map((c) => c.id)).toEqual([2, 1]);
  });

  it("adds nothing when that id is already in the list", () => {
    const list = [comment(2), comment(1)];
    expect(withComment(list, comment(2))).toBe(list);
  });

  it("keeps the copy that is already there, which may carry an edit", () => {
    const list = [comment(2, "edited")];
    expect(withComment(list, comment(2, "before the edit"))[0].content).toBe("edited");
  });

  it("matches ids whatever type they arrive as", () => {
    expect(withComment([comment(2)], comment("2"))).toHaveLength(1);
  });

  it("ignores something without an id", () => {
    const list = [comment(1)];
    expect(withComment(list, { id: undefined as never })).toBe(list);
  });
});

describe("uniqueComments", () => {
  it("keeps each id once, in the order it first appears", () => {
    const list = [comment(3), comment(2), comment(3), comment(1)];
    expect(uniqueComments(list).map((c) => c.id)).toEqual([3, 2, 1]);
  });

  it("treats the same id in two types as one comment", () => {
    expect(uniqueComments([comment(3), comment("3")])).toHaveLength(1);
  });

  it("drops entries without an id, which would render as an empty comment", () => {
    expect(uniqueComments([comment(1), { id: null as never }])).toHaveLength(1);
  });

  it("copes with nothing at all", () => {
    expect(uniqueComments([])).toEqual([]);
    expect(uniqueComments(undefined as never)).toEqual([]);
  });
});
