<template>
  <div class="ui chk" aria-hidden="true">
    <!-- Checklists are not a separate feature in the app — they are ordinary
         Markdown in the card description, counted automatically. So this is the
         list being ticked off, with the card's own meta count keeping up: 1/6,
         2/6, 3/6, exactly as the card tile writes it. -->
    <div class="ui-card chk__card">
      <div class="ui-card__row">
        <span class="ui-status" />
        <span class="ui-card__title">Redesign the logo</span>
      </div>
      <div class="ui-meta">
        <span class="ui-meta__item">
          <ListChecks :stroke-width="2" />
          <!-- Stacked rather than swapped, so the row never changes width as
               the number does. -->
          <span class="chk__count">
            <span
              v-for="n in items.length + 1"
              :key="n"
              class="chk__count-value"
              :class="`chk__count-value--${n - 1}`"
              >{{ n - 1 }}/{{ items.length }}</span
            >
            <span class="chk__count-space">0/{{ items.length }}</span>
          </span>
        </span>
        <span class="ui-meta__item">
          <MessageSquareText :stroke-width="2" />3
        </span>
      </div>
    </div>

    <ul class="chk__list">
      <li v-for="(item, index) in items" :key="item" class="chk__item">
        <span class="chk__box" :class="`chk__box--${index + 1}`">
          <Check :stroke-width="3.5" />
        </span>
        <span>{{ item }}</span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { Check, ListChecks, MessageSquareText } from "@lucide/vue";

// The checklist out of the card's description. Six of them: enough to fill the
// tile, and enough that the count visibly climbs rather than jumping.
const items = [
  "Collect references",
  "First round of concepts",
  "Team review",
  "Pick the final mark",
  "Export the assets",
  "Update the brand page",
];
</script>
