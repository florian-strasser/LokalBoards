<template>
    <!-- The list under the caret while `:fi…` is being typed. Tiptap's
         suggestion plugin puts this element into <body> and keeps it next to
         the caret, so the root stays even when nothing matches: the plugin
         needs something to hold on to. -->
    <div class="z-50">
        <ul
            v-if="items.length"
            role="listbox"
            class="w-64 rounded-xl border border-gray/20 dark:border-white/15 bg-white dark:bg-slate text-dark dark:text-white shadow-xl p-1"
        >
            <li v-for="(item, index) in items" :key="item.name">
                <!-- `mousedown.prevent`: a click must not take the focus out of
                     the editor, or the suggestion is gone before it is chosen. -->
                <button
                    type="button"
                    role="option"
                    :aria-selected="index === selected"
                    class="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left"
                    :class="
                        index === selected
                            ? 'bg-primary text-white'
                            : 'hover:bg-primary/10'
                    "
                    @mousedown.prevent="choose(index)"
                    @mousemove="selected = index"
                >
                    <span class="emoji-suggestion-glyph">{{ item.emoji }}</span>
                    <span class="truncate text-sm">{{ item.label }}</span>
                    <span
                        v-if="item.label !== `:${item.name}:`"
                        class="ml-auto shrink-0 text-xs opacity-60"
                        >:{{ item.name }}:</span
                    >
                </button>
            </li>
        </ul>
    </div>
</template>
<script setup lang="ts">
import type { EmojiEntry } from "~/utils/emojiSearch";

const props = defineProps<{
    items: EmojiEntry[];
    command: (attributes: { name: string }) => void;
}>();

const selected = ref(0);
watch(
    () => props.items,
    () => (selected.value = 0),
);

const choose = (index: number) => {
    const item = props.items[index];
    if (item) props.command({ name: item.name });
};

// Called by the editor for every key while the list is open; true means the
// key was used here and the editor should not act on it as well.
const onKeyDown = (event: KeyboardEvent) => {
    // Escape closes the list and nothing else. The plugin closes it, but the
    // key would go on up to the window, where the card's dialog listens for
    // it and closes too.
    if (event.key === "Escape") {
        event.stopPropagation();
        return true;
    }
    const count = props.items.length;
    if (!count) return false;
    if (event.key === "ArrowDown") {
        selected.value = (selected.value + 1) % count;
        return true;
    }
    if (event.key === "ArrowUp") {
        selected.value = (selected.value + count - 1) % count;
        return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
        choose(selected.value);
        return true;
    }
    return false;
};

defineExpose({ onKeyDown });
</script>
