import { describe, it, expect } from "vitest";
import {
  AREA_RING,
  clampToMap,
  layoutAreas,
  layoutCards,
  mapBounds,
  placeMap,
} from "../app/utils/mindMap";

// Where a board's nodes land when it is drawn as a mind map. The dragging
// itself, and that a place survives a reload and a change of layout, is driven
// end to end by tests/mind-map/run.mjs.

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

describe("layoutAreas", () => {
  it("puts the first area above the root and goes round from there", () => {
    const [first, second, third, fourth] = layoutAreas(4);
    expect([first!.x, first!.y]).toEqual([0, -AREA_RING]);
    expect(second!.x).toBeGreaterThan(0); // clockwise: right, then below
    expect(third!.y).toBeGreaterThan(0);
    expect(fourth!.x).toBeLessThan(0);
  });

  it("keeps every area the same distance from the root", () => {
    const ring = layoutAreas(5);
    const radii = ring.map((area) => Math.round(distance(area, { x: 0, y: 0 })));
    expect(new Set(radii).size).toBe(1);
  });

  it("draws a wider circle rather than a crowded one", () => {
    const few = distance(layoutAreas(3)[0]!, { x: 0, y: 0 });
    const many = distance(layoutAreas(14)[0]!, { x: 0, y: 0 });
    expect(many).toBeGreaterThan(few);
    // Neighbours still keep their distance at fourteen.
    const ring = layoutAreas(14);
    expect(distance(ring[0]!, ring[1]!)).toBeGreaterThan(200);
  });

  it("is nothing for a board with no areas", () => {
    expect(layoutAreas(0)).toEqual([]);
  });
});

describe("layoutCards", () => {
  const area = { x: 0, y: -AREA_RING, angle: -Math.PI / 2 };

  it("fans the cards away from the middle of the map", () => {
    const cards = layoutCards(area, 3);
    // The area is above the root, so its cards are above the area.
    expect(cards.every((card) => card.y < area.y)).toBe(true);
  });

  it("puts a single card straight out from its area", () => {
    const [only] = layoutCards(area, 1);
    expect(only!.x).toBe(0);
    expect(only!.y).toBeLessThan(area.y);
  });

  it("opens the fan wider as the cards pile up", () => {
    const three = layoutCards(area, 3);
    const twelve = layoutCards(area, 12);
    expect(distance(twelve[0]!, area)).toBeGreaterThan(distance(three[0]!, area));
  });
});

describe("placeMap", () => {
  const board = {
    areas: [{ id: 7 }, { id: 8 }],
    cards: { 7: [{ id: 1 }, { id: 2 }], 8: [{ id: 3 }] },
  };

  it("works a place out for everything that has never been dragged", () => {
    const map = placeMap(board);
    expect(map.root).toEqual({ x: 0, y: 0 });
    expect(Object.keys(map.areas)).toEqual(["7", "8"]);
    expect(Object.keys(map.cards)).toEqual(["1", "2", "3"]);
    expect(distance(map.areas[7]!, map.root)).toBeCloseTo(AREA_RING, 0);
  });

  it("leaves what somebody dragged exactly where they put it", () => {
    const map = placeMap(
      {
        areas: [{ id: 7, mapX: -40, mapY: 900 }, { id: 8 }],
        cards: { 7: [{ id: 1, mapX: 12, mapY: -34 }, { id: 2 }], 8: [{ id: 3 }] },
      },
      { mapX: 100, mapY: 100 },
    );
    expect(map.root).toEqual({ x: 100, y: 100 });
    expect(map.areas[7]).toEqual({ x: -40, y: 900 });
    expect(map.cards[1]).toEqual({ x: 12, y: -34 });
    // The area that was not dragged hangs off the root wherever the root is.
    expect(distance(map.areas[8]!, map.root)).toBeCloseTo(AREA_RING, 0);
  });

  it("fans a new card off its area even when the area was dragged", () => {
    const map = placeMap({
      areas: [{ id: 7, mapX: 2000, mapY: 2000 }],
      cards: { 7: [{ id: 1 }] },
    });
    expect(distance(map.cards[1]!, map.areas[7]!)).toBeGreaterThan(100);
  });

  it("holds a zero coordinate, which is a place like any other", () => {
    const map = placeMap({ areas: [{ id: 7, mapX: 0, mapY: 0 }], cards: {} });
    expect(map.areas[7]).toEqual({ x: 0, y: 0 });
  });
});

describe("mapBounds", () => {
  it("is the box round everything, with room to breathe", () => {
    const box = mapBounds(
      { root: { x: 0, y: 0 }, areas: { 1: { x: 300, y: 0 } }, cards: {} },
      100,
    );
    expect(box).toEqual({ x: -100, y: -100, width: 500, height: 200 });
  });
});

describe("clampToMap", () => {
  it("keeps a coordinate a number, and on the plane", () => {
    expect(clampToMap("12.6")).toBe(13);
    expect(clampToMap(-999999)).toBe(-100000);
    expect(clampToMap(999999)).toBe(100000);
  });

  it("refuses what is not a coordinate", () => {
    expect(clampToMap("over there")).toBeNull();
    expect(clampToMap(null)).toBeNull();
    expect(clampToMap(Infinity)).toBeNull();
    expect(clampToMap(undefined)).toBeNull();
  });
});
