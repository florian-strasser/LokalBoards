<template>
    <!-- What the card is labelled, on its own line under the buttons that add
         one. This is also where a label is changed: click the word to reword it,
         the cross to take it off. Both are on the label itself rather than in
         the menu, because the label is the thing you are pointing at. -->
    <div v-if="value.length" class="mt-3 flex flex-wrap items-center gap-1">
        <span
            v-for="label in value"
            :key="label.id"
            class="label-pill"
            :class="{ 'label-pill-editable': writeAccess }"
        >
            <!-- Rewording swaps the word for a field and nothing else: the pill
                 keeps its colour, its padding and its cross, so the label stays
                 the thing it was and only its text is in play. The wrapper is
                 what keeps it the same width — see `.label-pill-field`. -->
            <span
                v-if="editing === label.id"
                class="label-pill-field"
                :data-value="draft"
            >
                <input
                    :ref="bindField"
                    v-model="draft"
                    type="text"
                    size="1"
                    :maxlength="LABEL_NAME_MAX"
                    class="label-pill-input"
                    @keydown.enter.prevent="commit(label)"
                    @keydown.esc.stop.prevent="editing = null"
                    @blur="commit(label)"
                />
            </span>
            <button
                v-else-if="writeAccess"
                type="button"
                class="label-pill-name"
                @click="startEdit(label)"
                v-tooltip="$t('edit')"
            >
                {{ label.name }}
            </button>
            <template v-else>{{ label.name }}</template>
            <button
                v-if="writeAccess"
                type="button"
                class="label-pill-remove"
                @click="remove(label)"
                :aria-label="$t('remove')"
            >
                <X class="size-3.5" />
            </button>
        </span>
    </div>
</template>

<script setup lang="ts">
import { X } from "lucide-vue-next";
import { LABEL_NAME_MAX, resolveLabel } from "@/utils/labels";

const props = defineProps({
    boardID: Number,
    writeAccess: Boolean,
});

const value = defineModel<any[]>({ default: () => [] });
const emit = defineEmits(["labels-changed", "changed"]);

const editing = ref<number | null>(null);
const draft = ref("");

// The field, held through a function ref rather than a name: this input lives
// inside a `v-for`, and Vue collects a named ref there into an array instead of
// giving back the element.
const field = ref<HTMLInputElement | null>(null);
const bindField = (el: any) => {
    field.value = (el as HTMLInputElement) || null;
    takeFocus();
};

// Focus it as it appears, and again a frame later.
//
// Clicking the word focuses the button carrying it, and that button is then
// removed to make room for the field — at which point the browser sends focus
// back to the document body. That fix-up can land after a focus() call made
// during the same update, leaving a field that looks ready and swallows the
// first thing typed into it. Asking again on the next frame is what makes it
// stick.
function takeFocus() {
    const el = field.value;
    if (!el || document.activeElement === el) return;
    el.focus();
    el.select();
}

const startEdit = async (label: any) => {
    draft.value = label.name;
    editing.value = label.id;
    await nextTick();
    takeFocus();
    requestAnimationFrame(takeFocus);
};

// Rewording a label on this card points this card at another word. It does not
// rename anything on any other card: two cards saying "Bug" share one label, so
// renaming for everybody would quietly reword somebody else's card.
const commit = async (label: any) => {
    // A blur arriving after Escape already closed the field has nothing to
    // commit.
    if (editing.value !== label.id) return;
    const wanted = draft.value.trim();
    if (!wanted || wanted === label.name) {
        editing.value = null;
        return;
    }
    try {
        const next = await resolveLabel(props.boardID as number, wanted);
        if (!next) return;
        editing.value = null;

        // Swapped in place so the label does not jump to the end, and
        // de-duplicated in case the card already wore the word it has just been
        // reworded to.
        const reworded: any[] = [];
        for (const entry of value.value) {
            const replacement =
                entry.id === label.id
                    ? { id: next.id, name: next.name }
                    : entry;
            if (!reworded.some((kept) => kept.id === replacement.id))
                reworded.push(replacement);
        }
        value.value = reworded;
        await nextTick();
        emit("changed");
        emit("labels-changed");
    } catch (err) {
        console.error("Could not reword the label:", err);
    }
};

const remove = async (label: any) => {
    if (editing.value === label.id) editing.value = null;
    value.value = value.value.filter((entry: any) => entry.id !== label.id);
    await nextTick();
    emit("changed");
    // No `labels-changed`: the save that follows is what decides whether this
    // was the last card using the word, and asking for the list before that has
    // happened would only re-read the list as it was.
};
</script>
