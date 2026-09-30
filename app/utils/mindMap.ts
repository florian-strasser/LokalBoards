// Where a board's nodes sit when it is drawn as a mind map.
//
// The board is the node in the middle — the title, the same one the other
// layouts show at the top of the page — its areas branch off it, and each
// area's cards branch off that area. Anything somebody has dragged keeps the
// place they put it; everything else is worked out here, so a board that has
// never been opened as a map already looks like one, and a card made on a
// column this afternoon has somewhere sensible to appear.
//
// Coordinates are a plain plane in pixels with the root at (0, 0), positive to
// the right and down, and nothing about them depends on the size of the window
// they are drawn in. Panning and zooming happen on top and are not stored: the
// map is the same for everybody, the way the board's order is, while what you
// are looking at is yours.

export interface MapNode {
  x: number;
  y: number;
}

export interface LaidOutArea extends MapNode {
  id: number;
  /** Where the area sits on the circle around the root, in radians. */
  angle: number;
}

// Nodes this far apart do not overlap at the sizes the map draws them: an area
// is 17rem wide and a card 16rem, so two of them centred less than about 280px
// apart are on top of each other whatever the angle between them.
export const AREA_RING = 420; // from the root to the first ring of areas
export const AREA_GAP = 320; // added per area once a ring is full
export const CARD_RING = 360; // from an area to its cards
export const CARD_SPREAD = Math.PI / 2.2; // the fan a card list opens into

const round = (n: number) => Math.round(n);

/**
 * The areas around the root, evenly spaced on a circle wide enough for them.
 * The first area sits above the root and the rest go clockwise, so a board
 * with two or three areas reads left to right like the columns it came from.
 */
export function layoutAreas(count: number): LaidOutArea[] {
  if (count <= 0) return [];
  // Enough circumference that neighbours keep their distance; a board with
  // twelve areas draws a wider circle rather than a crowded one.
  const radius = Math.max(AREA_RING, (count * AREA_GAP) / (2 * Math.PI));
  return Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
    return {
      id: index,
      angle,
      x: round(Math.cos(angle) * radius),
      y: round(Math.sin(angle) * radius),
    };
  });
}

/**
 * The cards of one area, fanned out on the far side of it from the root, so a
 * branch grows outwards instead of back across the middle of the map.
 */
export function layoutCards(
  area: { x: number; y: number; angle: number },
  count: number,
): MapNode[] {
  if (count <= 0) return [];
  const radius = Math.max(CARD_RING, (count * 120) / CARD_SPREAD);
  const step = count === 1 ? 0 : CARD_SPREAD / (count - 1);
  const first = area.angle - (count === 1 ? 0 : CARD_SPREAD / 2);
  return Array.from({ length: count }, (_, index) => {
    const angle = first + index * step;
    return {
      x: round(area.x + Math.cos(angle) * radius),
      y: round(area.y + Math.sin(angle) * radius),
    };
  });
}

export interface MapInput {
  areas: { id: number; mapX?: number | null; mapY?: number | null }[];
  cards: Record<number, { id: number; mapX?: number | null; mapY?: number | null }[]>;
}

export interface MapPlacement {
  root: MapNode;
  areas: Record<number, MapNode>;
  cards: Record<number, MapNode>;
}

const placed = (node: { mapX?: number | null; mapY?: number | null }) =>
  typeof node.mapX === "number" && typeof node.mapY === "number";

/**
 * Every node's place on the map: what was dragged, and a spot worked out for
 * what was not. An area keeps its angle from the ring it would have sat on
 * even after it has been moved, so cards appearing under a dragged area still
 * fan out away from the middle.
 */
export function placeMap(
  input: MapInput,
  root: { mapX?: number | null; mapY?: number | null } = {},
): MapPlacement {
  const ring = layoutAreas(input.areas.length);
  const out: MapPlacement = {
    root: placed(root) ? { x: root.mapX!, y: root.mapY! } : { x: 0, y: 0 },
    areas: {},
    cards: {},
  };
  input.areas.forEach((area, index) => {
    const spot = ring[index] ?? { x: 0, y: AREA_RING, angle: Math.PI / 2 };
    const at = placed(area)
      ? { x: area.mapX!, y: area.mapY! }
      : { x: out.root.x + spot.x, y: out.root.y + spot.y };
    out.areas[area.id] = at;

    const cards = input.cards[area.id] ?? [];
    const fan = layoutCards({ ...at, angle: spot.angle }, cards.length);
    cards.forEach((card, cardIndex) => {
      out.cards[card.id] = placed(card)
        ? { x: card.mapX!, y: card.mapY! }
        : (fan[cardIndex] ?? at);
    });
  });
  return out;
}

/**
 * The box every node fits in, with room to breathe. What "fit the map on the
 * screen" is worked out from.
 */
export function mapBounds(
  placement: MapPlacement,
  margin = 200,
): { x: number; y: number; width: number; height: number } {
  const points = [
    placement.root,
    ...Object.values(placement.areas),
    ...Object.values(placement.cards),
  ];
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs) - margin;
  const minY = Math.min(...ys) - margin;
  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) + margin - minX,
    height: Math.max(...ys) + margin - minY,
  };
}

/** Coordinates a board is allowed to hold, so one bad drag cannot lose a card. */
export const MAP_LIMIT = 100000;

export const clampToMap = (value: unknown): number | null => {
  // `null` and `""` are not the middle of the map, whatever Number() says of
  // them: a node the client could not place must stay unplaced.
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return null;
  return Math.max(-MAP_LIMIT, Math.min(MAP_LIMIT, n));
};
