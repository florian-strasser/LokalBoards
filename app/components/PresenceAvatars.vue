<!-- Who is viewing a card right now.
     A pulsing dot marks the group as live — that is what tells it apart from
     the assignee avatar, which looks similar but means something else entirely
     (who owns the card, not who is looking at it).
     "compact" is for the dense board tiles, "detailed" adds a sentence naming
     who is there and is used in the card modal. -->
<template>
    <div
        v-if="users.length"
        class="flex items-center"
        :class="variant === 'detailed' ? 'gap-2.5' : 'gap-1.5'"
        v-tooltip="variant === 'compact' ? summary : ''"
    >
        <!-- Live indicator: steady core with a pulsing halo. The halo is
             motion-safe so it stays still for reduced-motion users. -->
        <span
            class="relative flex shrink-0"
            :class="dotClass"
            aria-hidden="true"
        >
            <span
                class="absolute inline-flex h-full w-full rounded-full bg-primary opacity-75 motion-safe:animate-ping"
            />
            <span
                class="relative inline-flex rounded-full bg-primary"
                :class="dotClass"
            />
        </span>
        <div class="flex items-center" :class="spacingClass">
            <span
                v-for="user in visible"
                :key="user.id"
                v-tooltip="label(user)"
                class="flex items-center justify-center overflow-hidden rounded-full bg-primary text-white ring-2 ring-white dark:ring-slate"
                :class="sizeClass"
            >
                <img
                    v-if="user.image"
                    :src="user.image"
                    class="h-full w-full object-cover"
                    :alt="user.name || ''"
                />
                <Bot v-else-if="user.type === 'artificial'" :class="iconClass" />
                <template v-else>{{
                    (user.name || "?").charAt(0).toUpperCase()
                }}</template>
            </span>
            <span
                v-if="overflow > 0"
                v-tooltip="overflowLabel"
                class="flex items-center justify-center rounded-full bg-gray text-white ring-2 ring-white dark:ring-slate"
                :class="sizeClass"
                >+{{ overflow }}</span
            >
        </div>
        <span v-if="variant === 'detailed'" class="text-sm text-gray">{{
            summary
        }}</span>
    </div>
</template>
<script setup lang="ts">
import { Bot } from "@lucide/vue";

const props = defineProps({
    users: { type: Array, default: () => [] },
    max: { type: Number, default: 4 },
    // "sm" for the dense board tiles, "md" inside the card modal.
    size: { type: String, default: "md" },
    // "compact" = dot + faces; "detailed" = also spells out who is there.
    variant: { type: String, default: "compact" },
});

const visible = computed(() => props.users.slice(0, props.max));
const overflow = computed(() => Math.max(0, props.users.length - props.max));

const sizeClass = computed(() =>
    props.size === "sm" ? "size-5 text-[0.625rem]" : "size-7 text-xs",
);
const iconClass = computed(() => (props.size === "sm" ? "size-3" : "size-4"));
const spacingClass = computed(() =>
    props.size === "sm" ? "-space-x-1.5" : "-space-x-2",
);
const dotClass = computed(() => (props.size === "sm" ? "size-1.5" : "size-2"));

const label = (user) =>
    user.type === "artificial"
        ? `${user.name} (${$t("userTypeArtificial")})`
        : user.name;

// "Alex is here right now" / "Alex and 2 others are here right now" — a whole
// sentence, so the row explains itself instead of needing a heading.
const summary = computed(() => {
    const [first, ...rest] = props.users;
    const name = first?.name || "?";
    return rest.length
        ? $t("presenceHereMany", { name, count: rest.length })
        : $t("presenceHereOne", { name });
});

// The hidden ones are still worth naming — that is the point of the "+N".
const overflowLabel = computed(() =>
    props.users
        .slice(props.max)
        .map((u) => label(u))
        .join(", "),
);
</script>
