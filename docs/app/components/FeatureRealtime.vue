<template>
  <div ref="root" class="ui rt" :class="{ 'rt--restart': restarting }" aria-hidden="true">
    <!-- Three areas out of a real board, drawn the way the app draws them:
         white panels on the grey surface, grey cards inside. One card is
         dragged Backlog → In Progress, ticked off where it is being worked on,
         then filed in Done — and the areas open and close a slot for it exactly
         as they do when you drag a card in LokalBoards, so the card is really
         put down rather than floated over the top.

         The two drags are made by two different people: the blue cursor hands
         the card over, the green one finishes it. -->
    <div
      v-for="(area, index) in areas"
      :key="area.name"
      class="ui-area rt__area"
    >
      <p class="ui-area__head">
        {{ area.name }}
        <Trash2 :stroke-width="1.75" />
      </p>

      <div v-for="card in area.cards" :key="card.title" class="ui-card">
        <div class="ui-card__row">
          <span class="ui-status" :class="{ 'ui-status--done': card.done }">
            <Check :stroke-width="3" />
          </span>
          <span class="ui-card__title">{{ card.title }}</span>
        </div>
        <div v-if="card.checklist || card.comments || card.due" class="ui-meta">
          <span v-if="card.checklist" class="ui-meta__item">
            <ListChecks :stroke-width="2" />{{ card.checklist }}
          </span>
          <span v-if="card.comments" class="ui-meta__item">
            <MessageSquareText :stroke-width="2" />{{ card.comments }}
          </span>
          <!-- Date and time in one flex item, or the row's `gap` lands between
               the date and its own comma. -->
          <span v-if="card.due" class="ui-meta__item">
            <Clock :stroke-width="2" />
            <span
              >{{ card.due
              }}<span v-if="card.time" class="rt__time"
                >, {{ card.time }}</span
              ></span
            >
          </span>
        </div>
      </div>

      <!-- The slot each area opens to hold the card. All three are in the same
           place, because each area's two cards come to the same height — one
           with a meta row, one without. That is what lets the card cross with a
           plain `translateX` and still land square in the gap the next area has
           opened for it. -->
      <div class="rt__slot" :class="`rt__slot--${index + 1}`">
        <div v-if="area.first" class="rt__mover">
          <div class="ui-card rt__card--live">
            <div class="ui-card__row">
              <span class="ui-status rt__status">
                <Check :stroke-width="3" />
              </span>
              <span class="ui-card__title">Draft the pricing page</span>
              <span class="ui-avatar rt__avatar">BS</span>
            </div>
            <div class="ui-meta">
              <span class="ui-meta__item">
                <Clock :stroke-width="2" />
                <span
                  >Aug 14<span class="rt__time">, 10:41 PM</span></span
                >
              </span>
            </div>
          </div>

          <!-- One cursor per hand-over. Both sit at the corner of the card and
               are only on screen while their own drag is happening. -->
          <svg class="rt__cursor rt__cursor--blue" viewBox="0 0 24 24">
            <path :d="pointer" />
          </svg>
          <svg class="rt__cursor rt__cursor--green" viewBox="0 0 24 24">
            <path :d="pointer" />
          </svg>
        </div>
      </div>

      <span class="ui-button rt__new">
        <Plus :stroke-width="2.5" />Create card
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
// The whole fragment is drawn in `em` against a font size that now follows the
// tile's width, so every distance in these keyframes — how far the card travels,
// how far an area opens — is resolved from a size that a resize changes. A
// running animation keeps what it resolved with, which leaves the card landing
// somewhere that was right for the old width until the page is reloaded.
//
// Restarting the loop on a resize re-resolves all of it. It costs a jump back to
// the beginning of the sequence, which is only ever seen by someone dragging a
// window edge — and better than a card put down in the wrong place.
const root = useTemplateRef<HTMLElement>("root");
const restarting = ref(false);

onMounted(() => {
  let width = root.value?.getBoundingClientRect().width ?? 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const observer = new ResizeObserver(([entry]) => {
    const next = entry?.contentRect.width ?? 0;
    if (Math.abs(next - width) < 1) return;
    width = next;
    clearTimeout(timer);
    // After the resize has settled, not during it: a restart per frame of a
    // drag would be its own kind of broken.
    timer = setTimeout(() => {
      restarting.value = true;
      requestAnimationFrame(() => requestAnimationFrame(() => (restarting.value = false)));
    }, 150);
  });

  if (root.value) observer.observe(root.value);
  onUnmounted(() => {
    clearTimeout(timer);
    observer.disconnect();
  });
});

import {
  Check,
  Clock,
  ListChecks,
  MessageSquareText,
  Plus,
  Trash2,
} from "@lucide/vue";

// The board from the demo screenshots, so the site and the screenshots on it
// are showing the same thing.
//
// Backlog and In Progress carry the same three cards' worth of height — two
// without a meta row and one with — so their slots line up exactly and the card
// crosses between them on a flat line. Done is one card shorter, which the
// travel keyframes make up with `--done-lift`.
const areas = [
  {
    name: "Backlog",
    first: true,
    cards: [
      { title: "Competitor research" },
      { title: "Redesign the logo", checklist: "1/3", comments: "3" },
      { title: "Write the launch announcement" },
    ],
  },
  {
    name: "In Progress",
    cards: [
      { title: "Build the public API", due: "Aug 8", time: "10:41 PM" },
      { title: "New onboarding flow" },
      { title: "Rework the settings screen" },
    ],
  },
  {
    name: "Done",
    cards: [
      { title: "Set up CI/CD", done: true },
      { title: "Launch the landing page", done: true, comments: "2" },
    ],
  },
];

const pointer =
  "M4 2 L4 18 L8.4 14.1 L11.4 20.5 L14.4 19 L11.4 12.9 L17 12.4 Z";
</script>
