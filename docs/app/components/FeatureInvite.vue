<template>
  <div class="ui inv" aria-hidden="true">
    <!-- The invite dialog, standing still. -->
    <p class="inv__head">Invite to Product Roadmap</p>

    <div class="inv__row">
      <span class="ui-input inv__input">alex@example.com</span>
      <span class="ui-button"><Send :stroke-width="2" />Invite</span>
    </div>

    <ul class="inv__people">
      <li v-for="person in people" :key="person.name" class="inv__person">
        <span class="ui-avatar">{{ person.initials }}</span>
        <span class="inv__name">{{ person.name }}</span>
        <span class="inv__role">{{ person.role }}</span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { Send } from "@lucide/vue";

const people = [
  { name: "Ben Schmidt", initials: "BS", role: "Owner" },
  { name: "Alex Morgan", initials: "AM", role: "Member" },
  { name: "Carol Nguyen", initials: "CN", role: "Member" },
  { name: "Jordan Rivera", initials: "JR", role: "Member" },
  { name: "Tom Fischer", initials: "TF", role: "Read only" },
];
</script>
