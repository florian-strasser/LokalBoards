<template>
    <!-- A third chip beside the due date and the assignee, and the only thing it
         does is add a label. It does not say what the card is labelled — the
         labels themselves are on the line below this row, where they are also
         renamed and removed. A button that listed them grew as they were added
         and shoved the two beside it around, and burying "take this one off"
         inside the menu that adds them made the common thing hard to find. -->
    <PopoverMenu v-if="writeAccess">
        <template #trigger>
            <button type="button" :class="CHIP">
                <Tag class="size-4 shrink-0" />
                <span>{{ $t("labels") }}</span>
            </button>
        </template>
        <template #default="{ close }">
            <form class="w-64 space-y-2" @submit.prevent="add(draft, close)">
                <input
                    :ref="focus"
                    v-model="draft"
                    type="text"
                    :maxlength="LABEL_NAME_MAX"
                    :placeholder="$t('labelName')"
                    class="form-control text-sm"
                />
                <!-- Words this board is already using. Typing narrows them, and
                     picking one is the same as typing it out: the same word is
                     the same label, so a board does not end up with three
                     spellings of "Bug". -->
                <div v-if="offered.length" class="flex flex-wrap gap-1">
                    <button
                        v-for="name in offered"
                        :key="name"
                        type="button"
                        class="label-pill"
                        @click="add(name, close)"
                    >
                        {{ name }}
                    </button>
                </div>
                <input
                    type="submit"
                    :disabled="!draft.trim()"
                    class="bg-primary hover:bg-primary-hover disabled:opacity-60 w-full rounded-lg px-3 py-1.5 text-sm text-white"
                    :value="$t('addLabel')"
                />
            </form>
        </template>
    </PopoverMenu>
</template>

<script setup lang="ts">
import { Tag } from "lucide-vue-next";
import { LABEL_NAME_MAX, resolveLabel } from "@/utils/labels";

const props = defineProps({
    boardID: Number,
    // Words this board is already using, held by the board page. Only ever
    // offered — nothing here maintains the list, because the list is not a
    // thing anybody keeps: it is whatever the cards happen to say.
    suggestions: { type: Array as () => any[], default: () => [] },
    writeAccess: Boolean,
});

// This card's labels, as `{ id, name }`. The card owns them and saves them
// along with everything else it changes.
const value = defineModel<any[]>({ default: () => [] });

// `changed` = this card's labels changed, so the card should save. The chips
// beside this one persist the moment they are touched, and a label that
// survived only until the dialog closed would be the odd one out.
// `labels-changed` = a word this board was not using is now in use, so whoever
// holds that list should re-read it.
const emit = defineEmits(["labels-changed", "changed"]);

const CHIP =
    "flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg text-dark dark:text-white bg-dark/5 dark:bg-white/10 hover:bg-dark/10 dark:hover:bg-white/20";

const draft = ref("");

// Focus the field as the menu opens, without stealing it back on every
// keystroke.
const focus = (el: any) => {
    if (el && document.activeElement !== el) el.focus();
};

const offered = computed(() => {
    const worn = new Set(
        value.value.map((label: any) => label.name.toLowerCase()),
    );
    const typed = draft.value.trim().toLowerCase();
    return props.suggestions
        .map((label: any) => label.name)
        .filter((name: string) => !worn.has(name.toLowerCase()))
        .filter((name: string) => !typed || name.toLowerCase().includes(typed))
        .slice(0, 12);
});

const add = async (name: string, close: () => void) => {
    const wanted = name.trim();
    if (!wanted) return;
    try {
        const label = await resolveLabel(props.boardID as number, wanted);
        if (!label) return;
        draft.value = "";
        // Closed rather than left open for another: this panel covers the line
        // the label just joined, and a menu that stays put looks like nothing
        // happened.
        close();
        if (value.value.some((entry: any) => entry.id === label.id)) return;
        value.value = [...value.value, { id: label.id, name: label.name }];
        // After the model has reached the card, so what it saves is what was
        // just typed rather than the state before it.
        await nextTick();
        emit("changed");
        emit("labels-changed");
    } catch (err) {
        console.error("Could not add the label:", err);
    }
};
</script>
