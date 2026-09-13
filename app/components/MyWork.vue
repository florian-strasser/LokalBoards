<template>
    <!-- The cards on you across every board, grouped by when they are due. A
         group is drawn the way an area is on a board and a card the way its
         tile is, with one line more: which board and area it sits on, the one
         thing a tile never needs to say because there you can see it. -->
    <div>
        <p v-if="!loaded" class="text-gray">…</p>
        <div
            v-else-if="!groups.length"
            class="text-gray rounded-lg bg-white p-4 dark:bg-slate"
        >
            {{ $t("myWorkEmpty") }}
        </div>
        <div v-else class="space-y-5">
            <section
                v-for="group in groups"
                :key="group.key"
                :data-work-group="group.key"
                class="space-y-1 rounded-lg bg-white p-4 dark:bg-slate"
            >
                <h2
                    class="text-dark flex items-center justify-between gap-2 font-bold dark:text-white"
                >
                    <span>{{ $t(HEADINGS[group.key]) }}</span>
                    <span class="text-gray text-sm font-normal tabular-nums">{{
                        group.cards.length
                    }}</span>
                </h2>
                <div
                    class="grid grid-cols-1 gap-2 pt-2 md:grid-cols-2 xl:grid-cols-3"
                >
                    <NuxtLink
                        v-for="card in group.cards"
                        :key="card.id"
                        :data-card-id="card.id"
                        :to="`/board/${card.boardId}?card=${card.id}`"
                        class="bg-dark/10 text-dark hover:bg-dark/15 block rounded-md p-2 text-left dark:bg-white/10 dark:text-white dark:hover:bg-white/15"
                    >
                        <span class="flex gap-x-2">
                            <!-- Always open: done cards are not work any more,
                                 so they are never here. The ring stays so the
                                 row reads as the card it is. -->
                            <span
                                class="border-gray size-6 shrink-0 grow-0 rounded-full border-2"
                            ></span>
                            <span class="min-w-0 shrink grow font-bold">{{
                                card.name
                            }}</span>
                        </span>
                        <span
                            v-if="
                                card.labels?.length ||
                                card.checklist?.total ||
                                card.dueDate
                            "
                            class="text-gray mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 pl-8 text-sm"
                        >
                            <span
                                v-if="card.labels?.length"
                                class="flex flex-wrap items-center gap-1"
                            >
                                <span
                                    v-for="label in card.labels"
                                    :key="label.id"
                                    class="label-pill"
                                    >{{ label.name }}</span
                                >
                            </span>
                            <span
                                v-if="card.checklist?.total"
                                class="flex shrink-0 gap-x-1.5"
                                :class="{
                                    'text-primary':
                                        card.checklist.done ===
                                        card.checklist.total,
                                }"
                            >
                                <ListChecks class="size-4 shrink-0 grow-0" />
                                <span class="shrink-0 grow-0"
                                    >{{ card.checklist.done }}/{{
                                        card.checklist.total
                                    }}</span
                                >
                            </span>
                            <span
                                v-if="card.dueDate"
                                class="flex shrink-0 items-center gap-x-1.5"
                                :class="{
                                    'text-dark font-semibold dark:text-white':
                                        group.key === 'overdue',
                                }"
                            >
                                <Clock class="size-4 shrink-0 grow-0" />
                                <span class="shrink-0 grow-0">{{
                                    dueLabel(card.dueDate)
                                }}</span>
                            </span>
                        </span>
                        <span class="text-gray mt-1 block pl-8 text-xs"
                            >{{ card.boardName }} · {{ card.areaName }}</span
                        >
                    </NuxtLink>
                </div>
            </section>
        </div>
    </div>
</template>

<script setup lang="ts">
import { Clock, ListChecks } from "lucide-vue-next";
import { groupMyWork } from "@/utils/myWork";

const { formatServerDate } = useServerDate();

const HEADINGS: Record<string, string> = {
    overdue: "filterOverdue",
    week: "thisWeek",
    later: "later",
};

const cards = ref<any[]>([]);
const loaded = ref(false);
// Read in the browser, after it has mounted: which group a card is in depends
// on what "today" is where the person is sitting, and the server rendering this
// page may well be somewhere else.
const now = ref(new Date());
const groups = computed(() => groupMyWork(cards.value, now.value));

onMounted(async () => {
    try {
        const data: any = await $fetch("/api/data/my-work");
        cards.value = data?.cards ?? [];
    } catch (err) {
        console.error("Could not read the cards assigned to you:", err);
    } finally {
        now.value = new Date();
        loaded.value = true;
    }
});

const dueLabel = (value: string) =>
    formatServerDate(value, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    });
</script>
