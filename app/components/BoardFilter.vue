<template>
    <!-- Beside the board's three-dots menu and shaped like it, because the two
         belong together: that one changes the board, this one changes what you
         are looking at. Filled while it is doing something, so a board showing
         a third of its cards never looks like a board that lost them. -->
    <PopoverMenu align="right">
        <template #trigger>
            <button
                type="button"
                v-tooltip="$t('filters')"
                :aria-label="$t('filters')"
                class="flex size-12 cursor-pointer items-center justify-center rounded-full"
                :class="
                    active
                        ? 'bg-primary text-white'
                        : 'bg-primary/10 text-primary hover:bg-primary hover:text-white dark:bg-white/10 dark:text-white'
                "
            >
                <ListFilter class="size-5" />
            </button>
        </template>
        <template #default>
            <div class="w-64 space-y-4">
                <section v-if="labels.length">
                    <p :class="HEADING">{{ $t("labels") }}</p>
                    <div class="flex flex-wrap gap-1">
                        <button
                            v-for="label in labels"
                            :key="label.id"
                            type="button"
                            class="label-pill"
                            :class="{
                                'ring-primary ring-2': value.labels.includes(
                                    label.id,
                                ),
                            }"
                            @click="toggle('labels', label.id)"
                        >
                            {{ label.name }}
                        </button>
                    </div>
                </section>

                <!-- The people who actually have a card here, taken from the
                     cards themselves: a board's member list would offer names
                     that would only ever filter to nothing. -->
                <section v-if="assignees.length">
                    <p :class="HEADING">{{ $t("assignee") }}</p>
                    <div class="space-y-1">
                        <button
                            v-for="person in assignees"
                            :key="person.id"
                            type="button"
                            :class="rowClass(value.assignees.includes(person.id))"
                            @click="toggle('assignees', person.id)"
                        >
                            <span
                                v-if="person.image"
                                class="size-5 shrink-0 overflow-hidden rounded-full"
                            >
                                <img
                                    :src="person.image"
                                    :alt="person.name"
                                    class="h-full w-full object-cover"
                                />
                            </span>
                            <!-- Nobody is not a person, so it does not get
                                 an initial in a filled circle the way the
                                 others do. -->
                            <span
                                v-else-if="person.id === UNASSIGNED"
                                class="border-gray text-gray flex size-5 shrink-0 items-center justify-center rounded-full border"
                            >
                                <UserRound class="size-3" />
                            </span>
                            <span
                                v-else
                                class="bg-primary flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] text-white"
                                >{{ initial(person) }}</span
                            >
                            <span class="truncate">{{ person.name }}</span>
                        </button>
                    </div>
                </section>

                <section>
                    <p :class="HEADING">{{ $t("dueDate") }}</p>
                    <div class="flex flex-wrap gap-1">
                        <button
                            v-for="option in DUE_OPTIONS"
                            :key="option"
                            type="button"
                            :class="chipClass(value.due === option)"
                            @click="pick('due', option)"
                        >
                            {{ $t(DUE_LABELS[option]) }}
                        </button>
                    </div>
                </section>

                <section>
                    <p :class="HEADING">{{ $t("status") }}</p>
                    <div class="flex flex-wrap gap-1">
                        <button
                            type="button"
                            :class="chipClass(value.done === false)"
                            @click="pick('done', false)"
                        >
                            {{ $t("filterOpen") }}
                        </button>
                        <button
                            type="button"
                            :class="chipClass(value.done === true)"
                            @click="pick('done', true)"
                        >
                            {{ $t("filterDone") }}
                        </button>
                    </div>
                </section>

                <button
                    v-if="active"
                    type="button"
                    class="text-primary hover:bg-primary/10 flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm"
                    @click="clear"
                >
                    <X class="size-4 shrink-0" />{{ $t("clearFilters") }}
                </button>
            </div>
        </template>
    </PopoverMenu>
</template>

<script setup lang="ts">
import { ListFilter, UserRound, X } from "lucide-vue-next";
import { EMPTY_FILTER, UNASSIGNED, isFiltering } from "@/utils/boardFilter";

defineProps({
    labels: { type: Array as () => any[], default: () => [] },
    assignees: { type: Array as () => any[], default: () => [] },
});

const value = defineModel<any>({ default: () => ({ ...EMPTY_FILTER }) });

const HEADING = "mb-1 text-xs font-bold tracking-wide text-gray uppercase";

const DUE_OPTIONS = ["overdue", "today", "week", "none"] as const;
const DUE_LABELS: Record<string, string> = {
    overdue: "filterOverdue",
    today: "filterDueToday",
    week: "filterDueThisWeek",
    none: "filterNoDueDate",
};

const active = computed(() => isFiltering(value.value));

const chipClass = (on: boolean) =>
    "rounded-lg px-2.5 py-1 text-sm " +
    (on
        ? "bg-primary text-white"
        : "bg-dark/5 dark:bg-white/10 text-dark dark:text-white hover:bg-dark/10 dark:hover:bg-white/20");

const rowClass = (on: boolean) =>
    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm " +
    (on
        ? "bg-primary text-white"
        : "text-dark dark:text-white hover:bg-dark/5 dark:hover:bg-white/10");

const initial = (person: any) =>
    String(person.name || "?")
        .charAt(0)
        .toUpperCase();

// The many-valued fields add and remove; the single-valued ones toggle off when
// the choice already showing is picked again, so the same click undoes it.
const toggle = (key: "labels" | "assignees", entry: any) => {
    const current = value.value[key] as any[];
    value.value = {
        ...value.value,
        [key]: current.includes(entry)
            ? current.filter((existing) => existing !== entry)
            : [...current, entry],
    };
};
const pick = (key: "due" | "done", entry: any) => {
    value.value = {
        ...value.value,
        [key]: value.value[key] === entry ? null : entry,
    };
};
const clear = () => {
    value.value = { ...EMPTY_FILTER };
};
</script>
