import { describe, it, expect } from "vitest";
import { placeCard, placeCardAfter } from "../server/utils/cardPositions";

// A column as the database has it, top to bottom; `*` marks an archived card.
const column = (spec: string) =>
  spec.split(" ").map((entry) => ({
    id: Number(entry.replace("*", "")),
    archived: entry.endsWith("*"),
  }));

describe("placeCard", () => {
  it("puts a card at the position the board counts, stepping over archived cards", () => {
    // The board shows 1, 3, 4. Dropped second, the card goes in front of 3.
    expect(placeCard(column("1 2* 3 4"), 9, 1)).toEqual([1, 2, 9, 3, 4]);
  });

  it("reorders a card already in the column past an archived one", () => {
    // 1 dragged below 3 on a board that shows 1, 3, 4.
    expect(placeCard(column("1 2* 3 4"), 1, 1)).toEqual([2, 3, 1, 4]);
  });

  it("puts it at the top when dropped first", () => {
    expect(placeCard(column("5* 1 2"), 9, 0)).toEqual([5, 9, 1, 2]);
  });

  it("puts it at the bottom when dropped last, or given no position", () => {
    expect(placeCard(column("1 2* 3"), 9, 2)).toEqual([1, 2, 3, 9]);
    expect(placeCard(column("1 2* 3"), 9, 99)).toEqual([1, 2, 3, 9]);
    expect(placeCard(column("1 2* 3"), 9, null)).toEqual([1, 2, 3, 9]);
    expect(placeCard(column("1 2* 3"), 9)).toEqual([1, 2, 3, 9]);
  });

  it("treats a negative position as the top", () => {
    expect(placeCard(column("1 2"), 9, -3)).toEqual([9, 1, 2]);
  });

  it("works in an empty column", () => {
    expect(placeCard([], 9, 0)).toEqual([9]);
  });

  it("keeps every card exactly once", () => {
    const order = placeCard(column("1 2* 3 4* 5"), 3, 2);
    expect([...order].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("placeCardAfter", () => {
  it("puts the copy directly under its original", () => {
    expect(placeCardAfter(column("1 2 3"), 9, 2)).toEqual([1, 2, 9, 3]);
  });

  it("moves it there if it was already somewhere else in the column", () => {
    // Inserted with the original's number, it may have sorted after it.
    expect(placeCardAfter(column("1 2 3 9"), 9, 1)).toEqual([1, 9, 2, 3]);
  });

  it("falls back to the bottom when the original is not there", () => {
    expect(placeCardAfter(column("1 2"), 9, 7)).toEqual([1, 2, 9]);
  });
});
