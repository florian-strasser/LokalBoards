<template>
    <button
        :key="props.card.id"
        :data-card-id="props.card.id"
        type="button"
        class="bg-dark/10 dark:bg-white/10 text-dark dark:text-white text-left p-2 rounded-md w-full"
        :class="{ 'ring-2 ring-primary': props.hasUnread }"
        @click="openModal(props.card.id)"
    >
        <div class="flex gap-x-2">
            <div
                class="w-6 h-6 rounded-full flex justify-center items-center shrink-0 grow-0"
                :class="{
                    'border-2 border-primary bg-primary text-white':
                        props.card.status,
                    'border-2 border-gray': !props.card.status,
                }"
            >
                <Check v-if="props.card.status" class="size-4" />
            </div>
            <div class="shrink grow">
                <h3 class="font-bold">
                    {{ props.card.name }}
                </h3>
            </div>
        </div>
        <!-- Labels sit on their own line under the name, indented to the same
             gutter as the counts below: what the card is, before what it has. -->
        <div
            v-if="props.card.labels?.length"
            class="pl-8 mt-1 flex flex-wrap gap-1"
        >
            <span
                v-for="label in props.card.labels"
                :key="label.id"
                class="label-pill"
                >{{ label.name }}</span
            >
        </div>
        <div
            v-if="
                props.card.commentCount ||
                props.card.attachmentCount ||
                checklist.total ||
                props.card.dueDate ||
                props.card.assignee ||
                props.viewers.length
            "
            class="pl-8 mt-1 flex items-center text-sm gap-x-3 flex-wrap text-gray"
        >
            <!-- Who has this card open right now (excluding yourself). Sits
                 with the other card info on the left; the assignee stays on
                 the right so the two are never confused. -->
            <PresenceAvatars
                v-if="props.viewers.length"
                :users="props.viewers"
                :max="3"
                size="sm"
            />
            <!-- Checklist progress, straight from the description's Markdown.
                 Turns green once everything is ticked — the colour this theme
                 uses for "done". -->
            <div
                v-if="checklist.total"
                class="flex gap-x-1.5 shrink-0"
                :class="{ 'text-primary': checklist.done === checklist.total }"
            >
                <ListChecks class="size-4 shrink-0 grow-0" />
                <div class="shrink-0 grow-0">
                    {{ checklist.done }}/{{ checklist.total }}
                </div>
            </div>
            <div class="flex gap-x-1.5 shrink-0" v-if="props.card.commentCount">
                <MessageSquareText class="size-4 shrink-0 grow-0" />
                <div class="shrink-0 grow-0">
                    {{ props.card.commentCount }}
                </div>
            </div>
            <div
                class="flex gap-x-1.5 shrink-0"
                v-if="props.card.attachmentCount"
            >
                <Paperclip class="size-4 shrink-0 grow-0" />
                <div class="shrink-0 grow-0">
                    {{ props.card.attachmentCount }}
                </div>
            </div>
            <div
                v-if="props.card.dueDate"
                class="flex gap-x-1.5 shrink-0 items-center"
                :class="{ 'text-dark dark:text-white font-semibold': isOverdue }"
            >
                <Clock class="size-4 shrink-0 grow-0" />
                <span class="shrink-0 grow-0">{{ dueDateLabel }}</span>
            </div>
            <div class="ml-auto flex shrink-0 items-center gap-2">
                <div
                    v-if="props.card.assignee"
                    class="shrink-0"
                    v-tooltip="props.card.assigneeName || ''"
                >
                    <img
                        v-if="props.card.assigneeImage"
                        :src="props.card.assigneeImage"
                        class="w-6 h-6 rounded-full object-cover"
                        :alt="props.card.assigneeName || ''"
                    />
                    <div
                        v-else
                        class="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center text-xs"
                    >
                        {{ (props.card.assigneeName || "?").substring(0, 1) }}
                    </div>
                </div>
            </div>
        </div>
    </button>
</template>
<script setup lang="ts">
import {
    Check,
    ListChecks,
    MessageSquareText,
    Paperclip,
    Clock,
} from "lucide-vue-next";

// Dates render in the instance's timezone and language, identically on the
// server and in the browser — see the composable.
const { formatServerDate } = useServerDate();

const cardModal = defineModel();
const props = defineProps({
    card: Object,
    // Whether this card has unread notifications for the current user.
    hasUnread: { type: Boolean, default: false },
    // Users currently viewing this card (already excludes the current user).
    viewers: { type: Array, default: () => [] },
});

// Recomputed whenever the card's content changes, which is what makes the
// counter live: a tick here, in the read view, or a change arriving from
// someone else all flow through the board's copy of the card.
const checklist = computed(() => checklistProgress(props.card?.content));

const isOverdue = computed(
    () =>
        !!props.card.dueDate &&
        !props.card.status &&
        new Date(props.card.dueDate).getTime() < Date.now(),
);

const dueDateLabel = computed(() =>
    formatServerDate(props.card.dueDate, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    }),
);
const openModal = (modalId) => {
    cardModal.value = modalId;
    setBodyScrollLock(true);
};
</script>
