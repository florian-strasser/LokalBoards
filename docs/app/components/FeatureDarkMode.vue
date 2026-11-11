<template>
  <div class="ui dm" aria-hidden="true">
    <!-- One board area, lit both ways. It is the area itself that changes and
         nothing else: no wrapper behind it, because a panel that is invisible
         against the tile in one theme and a solid dark block in the other reads
         as an extra thing appearing rather than as the same thing relit.

         Everything inside is tinted from the area's own text colour, which is
         how the app gets one set of values to work in both themes. -->
    <div class="ui-area dm__area">
      <p class="ui-area__head">
        This Week
        <span class="dm__toggle">
          <svg viewBox="0 0 24 24" class="dm__icon dm__icon--sun">
            <circle cx="12" cy="12" r="4.5" fill="currentColor" />
            <g stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2" />
            </g>
          </svg>
          <svg viewBox="0 0 24 24" class="dm__icon dm__icon--moon">
            <path
              d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"
              fill="currentColor"
            />
          </svg>
        </span>
      </p>

      <div v-for="card in cards" :key="card.title" class="ui-card">
        <div class="ui-card__row">
          <span class="ui-status" :class="{ 'ui-status--done': card.done }">
            <Check :stroke-width="3" />
          </span>
          <span class="ui-card__title">{{ card.title }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Check } from "@lucide/vue";

const cards = [
  { title: "Buy groceries" },
  { title: "Call the dentist" },
  { title: "Book the flights" },
  { title: "Renew the domain", done: true },
  { title: "Finish the quarterly report", done: true },
];
</script>
