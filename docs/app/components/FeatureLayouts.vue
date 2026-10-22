<template>
  <div class="ui lay" aria-hidden="true">
    <!-- The board's layout option, switching. The control is the app's
         segmented control; below it the very same areas and the very same cards
         rearrange themselves — side by side as columns, stacked full width as a
         list, and branching off the board's name as a mind map. Showing
         different content in the views would suggest the layout changes what is
         on the board, and it does not. -->
    <div class="lay__control">
      <span class="lay__thumb" />
      <span class="lay__option">Kanban</span>
      <span class="lay__option">To-do</span>
      <span class="lay__option">Mind map</span>
    </div>

    <div class="lay__stage">
      <div class="lay__view lay__view--kanban">
        <div v-for="area in areas" :key="area.name" class="ui-area lay__col">
          <p class="ui-area__head">{{ area.name }}</p>
          <div v-for="card in area.cards" :key="card" class="ui-card">
            <div class="ui-card__row">
              <span class="ui-status" />
              <span class="ui-card__title">{{ card }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="lay__view lay__view--todo">
        <div v-for="area in areas" :key="area.name" class="ui-area">
          <p class="ui-area__head">{{ area.name }}</p>
          <div v-for="card in area.cards" :key="card" class="ui-card">
            <div class="ui-card__row">
              <span class="ui-status" />
              <span class="ui-card__title">{{ card }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- The map: the board's name in the middle, the first area above it
           and the second below, and each area's cards around it. A card is only
           its title here, as it is on the real thing. -->
      <div class="lay__view lay__view--mind">
        <div class="lay__map">
          <svg
            class="lay__branches"
            :viewBox="`0 0 ${MAP.width * 10} ${MAP.height * 10}`"
            preserveAspectRatio="none"
          >
            <path v-for="branch in map.branches" :key="branch" :d="branch" />
          </svg>
          <span class="lay__node lay__node--root" :style="at(map.root)">{{
            board
          }}</span>
          <template v-for="area in map.areas" :key="area.name">
            <span class="lay__node lay__node--area" :style="at(area)">{{
              area.name
            }}</span>
            <span
              v-for="card in area.cards"
              :key="card.name"
              class="lay__node lay__node--card"
              :style="at(card)"
              >{{ card.name }}</span
            >
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// The board the other demos on the page are of.
const board = "Product Roadmap";

// One set of areas, drawn three times.
const areas = [
  {
    name: "Backlog",
    cards: [
      "Competitor research",
      "Redesign the logo",
      "Draft the pricing page",
      "Write the launch announcement",
    ],
  },
  {
    name: "In Progress",
    cards: [
      "Build the public API",
      "New onboarding flow",
      "Rework the settings",
      "Write the API docs",
    ],
  },
];

// The map's own plane, in `em`, so it scales with the fragment like everything
// else in these demos. Nodes are placed by their centres; the branches are
// drawn in the same numbers times ten, which is all the SVG's viewBox is.
//
// Each area is a hub with its cards at its four corners rather than in a row
// beyond it. A row of four is what the app does with a board nobody has
// arranged, but in a space this size it leaves each card ten characters of its
// title; two either side of the area leaves nearly all of it, and a map that
// has been arranged by hand looks like this anyway.
const MAP = { width: 34, height: 16.4 };
const CARD_WIDTH = 11.6;

const map = (() => {
  const middle = { x: MAP.width / 2, y: MAP.height / 2 };
  const branches: string[] = [];
  type Point = { x: number; y: number };
  // Out of the board's name a branch goes straight up or down; out of an area
  // it goes sideways. Either way it leaves and arrives along the same axis,
  // which is what makes it read as growing from one node into the other.
  const branch = (from: Point, to: Point, sideways: boolean) => {
    const [a, b] = sideways
      ? [{ x: from.x + (to.x - from.x) * 0.5, y: from.y }, { x: to.x - (to.x - from.x) * 0.5, y: to.y }]
      : [{ x: from.x, y: from.y + (to.y - from.y) * 0.5 }, { x: to.x, y: to.y - (to.y - from.y) * 0.5 }];
    branches.push(
      `M ${from.x * 10} ${from.y * 10} C ${a.x * 10} ${a.y * 10}, ${b.x * 10} ${b.y * 10}, ${to.x * 10} ${to.y * 10}`,
    );
  };
  const laid = areas.map((area, index) => {
    // The first area above the board's name, the second below.
    const side = index === 0 ? -1 : 1;
    const node = { name: area.name, x: middle.x, y: middle.y + side * 4.9 };
    branch(middle, node, false);
    // Two cards to the left of the area and two to the right, one above its
    // line and one below.
    const cards = area.cards.map((name, position) => {
      const card = {
        name,
        x: position < 2 ? CARD_WIDTH / 2 : MAP.width - CARD_WIDTH / 2,
        y: node.y + (position % 2 === 0 ? -2.15 : 2.15),
      };
      branch(node, card, true);
      return card;
    });
    return { ...node, cards };
  });
  return { root: middle, areas: laid, branches };
})();

const at = (node: { x: number; y: number }) => ({
  left: `${node.x}em`,
  top: `${node.y}em`,
});
</script>
