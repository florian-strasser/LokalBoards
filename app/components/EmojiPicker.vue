<template>
    <!-- Every emoji this device can draw, searchable. It lives in a popover, so
         it floats over the editor however much it holds — the old picker took
         the toolbar's place and pushed the text down with every emoji it was
         given, which is why it only ever had eight. Those eight are still the
         first row. -->
    <div class="w-72">
        <input
            ref="search"
            v-model="query"
            type="text"
            :placeholder="$t('editorEmojiSearch')"
            :aria-label="$t('editorEmojiSearch')"
            class="form-control text-sm"
            @keydown.enter.prevent="pickFirst"
        />
        <div v-if="!searching" class="mt-2 flex justify-between">
            <button
                v-for="group in EMOJI_GROUPS"
                :key="group.key"
                type="button"
                class="emoji-cell w-8"
                @click="jump(group.key)"
            >
                {{ group.icon }}
            </button>
        </div>
        <!-- One click handler for the lot rather than one per emoji: there are
             close to two thousand of them. -->
        <div
            ref="scroller"
            class="relative mt-2 h-64 overflow-y-auto"
            @click="onPick"
        >
            <template v-if="searching">
                <p
                    v-if="!results.length"
                    class="py-8 text-center text-sm text-gray"
                >
                    {{ $t("editorEmojiNone") }}
                </p>
                <div v-else class="emoji-grid">
                    <button
                        v-for="entry in results"
                        :key="entry.name"
                        type="button"
                        class="emoji-cell"
                        :data-name="entry.name"
                        :title="entry.label"
                    >
                        {{ entry.emoji }}
                    </button>
                </div>
            </template>
            <template v-else>
                <div class="emoji-grid emoji-section">
                    <button
                        v-for="entry in quick"
                        :key="entry.name"
                        type="button"
                        class="emoji-cell"
                        :data-name="entry.name"
                        :title="entry.label"
                    >
                        {{ entry.emoji }}
                    </button>
                </div>
                <div
                    v-for="section in sections"
                    :key="section.key"
                    :data-group="section.key"
                    class="emoji-grid emoji-section"
                >
                    <button
                        v-for="entry in section.entries"
                        :key="entry.name"
                        type="button"
                        class="emoji-cell"
                        :data-name="entry.name"
                        :title="entry.label"
                    >
                        {{ entry.emoji }}
                    </button>
                </div>
            </template>
        </div>
    </div>
</template>
<script setup lang="ts">
import { EMOJI_GROUPS, QUICK_EMOJI, searchEmoji } from "~/utils/emojiSearch";

const emit = defineEmits<{ pick: [name: string] }>();

const { entries, loadLanguage } = useEmojiIndex();

const query = ref("");
const search = ref<HTMLInputElement | null>(null);
const scroller = ref<HTMLElement | null>(null);

// The search field takes the focus as the picker opens, so typing finds an
// emoji straight away. In `onMounted`, not a function ref: a ref is handed the
// field before the popover has put it into the page, and focusing something
// that is not in the page does nothing — it only ever worked when something
// happened to render the picker a second time.
onMounted(() => {
    search.value?.focus({ preventScroll: true });
    loadLanguage();
});

const searching = computed(() => query.value.trim() !== "");
const results = computed(() => searchEmoji(entries.value, query.value, 200));

const quick = computed(() =>
    QUICK_EMOJI.map((name) =>
        entries.value.find((entry) => entry.name === name),
    ).filter((entry) => entry !== undefined),
);

const sections = computed(() =>
    EMOJI_GROUPS.map((group) => ({
        key: group.key,
        entries: entries.value.filter((entry) => entry.group === group.key),
    })).filter((section) => section.entries.length),
);

const onPick = (event: MouseEvent) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>(
        "button[data-name]",
    );
    if (button?.dataset.name) emit("pick", button.dataset.name);
};

const pickFirst = () => {
    const first = results.value[0];
    if (first) emit("pick", first.name);
};

// Scrolls the list itself rather than calling `scrollIntoView`, which would
// also scroll whatever is behind the popover to bring the section into view.
const jump = (key: string) => {
    const section = scroller.value?.querySelector<HTMLElement>(
        `[data-group="${key}"]`,
    );
    if (scroller.value && section) scroller.value.scrollTop = section.offsetTop;
};
</script>
