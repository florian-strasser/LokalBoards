<!-- Who a card is on. One person looks exactly as a card has always looked;
     several overlap, the first in front, and past `max` the rest are a count.
     The overlap is small on purpose: at this size a face is often a single
     letter, and more than a few pixels of the next circle covers it.
     The names are in the tooltip, all of them, since the faces are what gets
     cut short. Unlike PresenceAvatars there is no live dot: this is who owns
     the card, not who is looking at it. -->
<template>
    <span
        v-if="people.length"
        class="flex shrink-0 grow-0 items-center"
        :class="people.length > 1 ? '-space-x-1' : ''"
        v-tooltip="names"
        :aria-label="names"
    >
        <span
            v-for="(person, index) in visible"
            :key="person.id"
            class="relative flex items-center justify-center overflow-hidden rounded-full bg-primary text-white text-xs"
            :class="[
                sizeClass,
                people.length > 1 ? 'ring-2 ring-white dark:ring-slate' : '',
            ]"
            :style="{ zIndex: visible.length - index }"
        >
            <img
                v-if="person.image"
                :src="person.image"
                :alt="person.name || ''"
                class="h-full w-full object-cover"
            />
            <Bot
                v-else-if="person.type === 'artificial'"
                class="size-3.5"
            />
            <template v-else>{{
                (person.name || "?").substring(0, 1)
            }}</template>
        </span>
        <span
            v-if="overflow > 0"
            class="relative flex items-center justify-center rounded-full bg-gray text-white text-xs ring-2 ring-white dark:ring-slate"
            :class="sizeClass"
            >+{{ overflow }}</span
        >
    </span>
</template>
<script setup lang="ts">
import { Bot } from "lucide-vue-next";

const props = defineProps({
    people: { type: Array as () => any[], default: () => [] },
    max: { type: Number, default: 3 },
    // "sm" inside a chip, "md" on a tile or a search hit.
    size: { type: String, default: "md" },
});

const visible = computed(() => props.people.slice(0, props.max));
const overflow = computed(() => Math.max(0, props.people.length - props.max));
const sizeClass = computed(() => (props.size === "sm" ? "size-5" : "size-6"));
const names = computed(() =>
    props.people.map((person) => person.name || "?").join(", "),
);
</script>
