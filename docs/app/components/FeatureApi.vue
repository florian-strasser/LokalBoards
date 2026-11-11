<template>
  <div class="ui api" aria-hidden="true">
    <!-- A real request against the real endpoint, and the agent account that
         would be making it. -->
    <pre class="ui-code api__code"><code><span class="ui-code__comment"># create a card from anything</span>
curl <span class="ui-code__key">-X</span> POST \
  <span class="ui-code__key">-H</span> "Authorization: Bearer $KEY" \
  <span class="ui-code__key">-d</span> '{"area":2,"name":"Release notes"}' \
  boards.example.com<span class="ui-code__key">/api/cards</span>

<span class="ui-code__comment"># → 201 Created</span>
<span class="ui-code__comment"># { "id": 42, "area": 2, "status": 0 }</span></code></pre>

    <div class="ui-card api__card">
      <div class="ui-card__row">
        <span class="ui-status" />
        <span class="ui-card__title">Ship the release notes</span>
        <span class="api__agent"><Bot :stroke-width="2" />Agent</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Bot } from "@lucide/vue";
</script>
