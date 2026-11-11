<template>
  <div class="ui trl" aria-hidden="true">
    <!-- The import dialog, and what actually comes across with the board. -->
    <p class="trl__head">Import from Trello</p>
    <span class="ui-input trl__input">trello.com/b/aBc12XyZ/roadmap</span>
    <span class="ui-button"><Download :stroke-width="2" />Import board</span>

    <ul class="trl__brings">
      <li v-for="item in brings" :key="item" class="trl__item">
        <Check :stroke-width="3" />{{ item }}
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { Check, Download } from "@lucide/vue";

const brings = [
  "Lists and cards",
  "Descriptions and checklists",
  "Comments and attachments",
  "What was already done",
];
</script>
