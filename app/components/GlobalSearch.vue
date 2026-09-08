<template>
    <!-- `search-shell` is what carries `--search-max`, the width this field's
         placeholder needs. The stylesheet sets it per language so the field is
         the right size on the first paint; the measurement below lands on the
         same number, so nothing moves when it does. -->
    <div
        ref="root"
        class="search-shell relative"
        :style="
            !inModal && natural ? { '--search-max': `${natural}px` } : undefined
        "
    >
        <!-- The border is the field's own background colour, so it is invisible at
             rest and can turn primary on focus — the same affordance the card
             description and comment editors have. The vertical padding is one
             pixel short of the nav's to pay for the border, so both stay the
             same height. -->
        <label
            class="relative block rounded-full border focus-within:border-primary"
            :class="
                inModal
                    ? 'border-gray/20 bg-dark/5 dark:border-white/15 dark:bg-white/10'
                    : 'border-white bg-white dark:border-slate dark:bg-slate'
            "
        >
            <Search
                class="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-gray"
            />
            <input
                ref="input"
                v-model="term"
                type="search"
                autocomplete="off"
                :aria-label="$t('headerSearch')"
                class="w-full rounded-full bg-transparent py-[15px] pr-4 pl-10 text-sm text-dark focus:outline-none dark:text-white"
                @focus="reopen"
                @click="reopen"
                @keydown.esc="close"
            />
            <!-- The placeholder, as an element rather than the input's own
                 attribute.

                 It is a full sentence and the field is often narrower than it,
                 so the tail has to fade rather than be chopped mid-letter — and
                 fading it means knowing whether it is too long, which is the
                 part that kept going wrong. Every attempt to work that out from
                 the font was a guess: `measureText` does not know that Safari
                 renders 14px text at whatever minimum font size is set, and a
                 cloned input counts a cancel button a placeholder never has.
                 A element of our own can simply be asked — `scrollWidth`
                 against `clientWidth` is what the browser did, not a model of
                 it, and it is right whatever the font turns out to be.

                 It sits exactly where the input's own placeholder would: from
                 the icon's edge to the padding, vertically centred. -->
            <span
                v-if="!term"
                ref="hint"
                aria-hidden="true"
                class="text-gray pointer-events-none absolute inset-y-0 right-4 left-10 flex items-center overflow-hidden text-sm whitespace-nowrap"
                :class="{ 'fade-clip': hintOverflows }"
                >{{ $t("searchPlaceholder") }}</span
            >
        </label>

        <!-- Rendered into <body> and positioned against the field, the same way
             the notification panel is: inside the header it would be clipped by
             the layout, and `100vw` would ignore a classic scrollbar.

             Inside the modal none of that applies: the dialog is already the
             top layer and already the right width, so the Teleport is switched
             off and the results render where they are written, under the field,
             scrolling with the dialog rather than in a box of their own. Same
             markup either way — the results are the part worth not having two
             copies of. -->
        <Teleport to="body" :disabled="inModal">
            <div
                v-if="showPanel"
                ref="panel"
                :style="inModal ? undefined : panelStyle"
                :class="
                    inModal
                        ? 'mt-4 text-left'
                        : 'fixed z-50 overflow-clip rounded-lg bg-white shadow-lg dark:bg-slate'
                "
            >
                <div
                    class="space-y-5 transition-opacity"
                    :class="[
                        inModal ? '' : 'max-h-[70vh] overflow-y-auto p-3',
                        // Waiting for the page the click asked for. The results
                        // stay exactly where they are — dimmed, and no longer
                        // clickable, so a second click cannot queue a second
                        // navigation behind the first.
                        following ? 'pointer-events-none opacity-50' : '',
                    ]"
                >
                    <p
                        v-if="needle.length > 0 && needle.length < 2"
                        class="px-1 text-sm text-gray"
                    >
                        {{ $t("searchHint") }}
                    </p>
                    <p v-else-if="loading" class="px-1 text-sm text-gray">
                        {{ $t("searchLoading") }}
                    </p>
                    <p
                        v-else-if="needle.length >= 2 && total === 0"
                        class="px-1 text-sm text-gray"
                    >
                        {{ $t("searchNoResults", { query: needle }) }}
                    </p>

                    <!-- Each group renders the thing it found the way the app
                         renders it elsewhere — a board tile, a card tile, a
                         comment bubble, an attachment row — so a result is
                         recognisable at a glance instead of being one more line
                         of text in a list. -->
                    <section v-if="results.boards.length">
                        <h3 class="mb-2 px-1 text-xs font-semibold tracking-wide text-gray uppercase">
                            {{ $t("searchBoards") }}
                        </h3>
                        <div class="space-y-2">
                            <!-- Deliberately not the dashboard's picture tile:
                                 at this size a photo says nothing and crowds
                                 the list. The same grey box the cards use, with
                                 the board's name and who is on it. -->
                            <NuxtLink
                                v-for="board in results.boards"
                                :key="`b${board.id}`"
                                :to="`/board/${board.id}`"
                                @click="follow"
                                class="flex items-center gap-3 rounded-md bg-dark/10 p-2 text-dark hover:bg-dark/15 dark:bg-white/10 dark:text-white dark:hover:bg-white/15"
                            >
                                <span class="min-w-0 shrink grow truncate font-bold"
                                    ><Highlight :text="board.name" :term="query"
                                /></span>
                                <span
                                    v-if="!board.owned"
                                    class="shrink-0 rounded-full bg-dark/10 px-2 py-0.5 text-xs font-medium text-gray dark:bg-white/10"
                                    >{{ $t("sharedBadge") }}</span
                                >
                                <span
                                    v-if="board.members?.length"
                                    class="flex shrink-0 -space-x-2"
                                >
                                    <span
                                        v-for="member in board.members"
                                        :key="member.id"
                                        class="flex size-6 items-center justify-center overflow-hidden rounded-full bg-primary text-xs font-medium text-white ring-2 ring-white dark:ring-slate"
                                        :title="member.name"
                                    >
                                        <img
                                            v-if="member.image"
                                            :src="member.image"
                                            :alt="member.name"
                                            class="h-full w-full object-cover"
                                        />
                                        <template v-else>{{
                                            (member.name || "?")
                                                .charAt(0)
                                                .toUpperCase()
                                        }}</template>
                                    </span>
                                    <span
                                        v-if="board.memberCount > board.members.length"
                                        class="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-medium text-white ring-2 ring-white dark:ring-slate"
                                        >+{{
                                            board.memberCount -
                                            board.members.length
                                        }}</span
                                    >
                                </span>
                            </NuxtLink>
                        </div>
                    </section>

                    <section v-if="results.cards.length">
                        <h3 class="mb-2 px-1 text-xs font-semibold tracking-wide text-gray uppercase">
                            {{ $t("searchCards") }}
                        </h3>
                        <div class="space-y-2">
                            <NuxtLink
                                v-for="card in results.cards"
                                :key="`c${card.id}`"
                                :to="`/board/${card.boardId}?card=${card.id}`"
                                @click="follow"
                                class="block rounded-md bg-dark/10 p-2 text-left text-dark hover:bg-dark/15 dark:bg-white/10 dark:text-white dark:hover:bg-white/15"
                            >
                                <span class="flex gap-x-2">
                                    <span
                                        class="flex size-6 shrink-0 grow-0 items-center justify-center rounded-full"
                                        :class="
                                            card.status
                                                ? 'border-2 border-primary bg-primary text-white'
                                                : 'border-2 border-gray'
                                        "
                                    >
                                        <Check v-if="card.status" class="size-4" />
                                    </span>
                                    <span class="min-w-0 shrink grow">
                                        <span class="block font-bold"
                                            ><Highlight
                                                :text="card.name"
                                                :term="query"
                                        /></span>
                                        <span
                                            v-if="card.snippet"
                                            class="mt-0.5 block text-sm text-gray"
                                            ><Highlight
                                                :text="card.snippet"
                                                :term="query"
                                        /></span>
                                    </span>
                                </span>
                                <!-- Labels on their own line above the counts,
                                     as on the board's own tile — and the reason
                                     the hit is here at all when the word that
                                     matched was one of them. -->
                                <span
                                    v-if="card.labels?.length"
                                    class="mt-1 flex flex-wrap gap-1 pl-8"
                                >
                                    <span
                                        v-for="label in card.labels"
                                        :key="label.id"
                                        class="label-pill"
                                        >{{ label.name }}</span
                                    >
                                </span>
                                <!-- The card's own meta line, as on the board. -->
                                <span
                                    v-if="cardHasMeta(card)"
                                    class="mt-1 flex flex-wrap items-center gap-x-3 pl-8 text-sm text-gray"
                                >
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
                                        v-if="card.commentCount"
                                        class="flex shrink-0 gap-x-1.5"
                                    >
                                        <MessageSquareText class="size-4 shrink-0 grow-0" />
                                        <span class="shrink-0 grow-0">{{
                                            card.commentCount
                                        }}</span>
                                    </span>
                                    <span
                                        v-if="card.attachmentCount"
                                        class="flex shrink-0 gap-x-1.5"
                                    >
                                        <Paperclip class="size-4 shrink-0 grow-0" />
                                        <span class="shrink-0 grow-0">{{
                                            card.attachmentCount
                                        }}</span>
                                    </span>
                                    <span
                                        v-if="card.dueDate"
                                        class="flex shrink-0 items-center gap-x-1.5"
                                        :class="{
                                            'font-semibold text-dark dark:text-white':
                                                isOverdue(card.dueDate),
                                        }"
                                    >
                                        <Clock class="size-4 shrink-0 grow-0" />
                                        <span class="shrink-0 grow-0">{{
                                            dueDateLabel(card.dueDate)
                                        }}</span>
                                    </span>
                                    <span
                                        v-if="card.assignee"
                                        class="ml-auto shrink-0"
                                        :title="card.assigneeName || ''"
                                    >
                                        <img
                                            v-if="card.assigneeImage"
                                            :src="card.assigneeImage"
                                            :alt="card.assigneeName || ''"
                                            class="size-6 rounded-full object-cover"
                                        />
                                        <span
                                            v-else
                                            class="flex size-6 items-center justify-center rounded-full bg-primary text-xs text-white"
                                            >{{
                                                (
                                                    card.assigneeName || "?"
                                                ).substring(0, 1)
                                            }}</span
                                        >
                                    </span>
                                </span>
                                <!-- Which board and area it sits on: the one
                                     thing a tile on the board never needs to
                                     say, because there you can see it. -->
                                <span class="mt-1 block pl-8 text-xs text-gray"
                                    >{{ card.boardName }} ·
                                    {{ card.areaName }}</span
                                >
                            </NuxtLink>
                        </div>
                    </section>

                    <section v-if="results.comments.length">
                        <h3 class="mb-2 px-1 text-xs font-semibold tracking-wide text-gray uppercase">
                            {{ $t("searchComments") }}
                        </h3>
                        <div class="space-y-3">
                            <!-- A comment as the card shows it: the bubble,
                                 then who wrote it beneath. Hovering lifts the
                                 bubble's own border rather than washing a block
                                 of colour behind the whole row. -->
                            <NuxtLink
                                v-for="comment in results.comments"
                                :key="`co${comment.id}`"
                                :to="`/board/${comment.boardId}?card=${comment.cardId}&comment=${comment.id}`"
                                @click="follow"
                                class="group block"
                            >
                                <span
                                    class="block rounded-xl border border-dark/10 bg-dark/10 p-3 text-sm text-dark group-hover:border-primary dark:border-white/10 dark:bg-white/10 dark:text-white"
                                    ><Highlight
                                        :text="comment.snippet"
                                        :term="query"
                                /></span>
                                <span class="mt-2 flex items-center gap-2 px-1">
                                    <span
                                        class="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-xs text-white"
                                    >
                                        <img
                                            v-if="comment.authorImage"
                                            :src="comment.authorImage"
                                            :alt="comment.authorName || ''"
                                            class="h-full w-full object-cover"
                                        />
                                        <template v-else>{{
                                            (comment.authorName || "?")
                                                .substring(0, 1)
                                                .toUpperCase()
                                        }}</template>
                                    </span>
                                    <span
                                        class="min-w-0 text-xs text-gray"
                                    >
                                        <span
                                            class="font-medium text-dark dark:text-white"
                                            >{{ comment.authorName }}</span
                                        >
                                        {{ comment.cardName }} ·
                                        {{ comment.boardName }}
                                    </span>
                                </span>
                            </NuxtLink>
                        </div>
                    </section>

                    <section v-if="results.attachments.length">
                        <h3 class="mb-2 px-1 text-xs font-semibold tracking-wide text-gray uppercase">
                            {{ $t("searchAttachments") }}
                        </h3>
                        <div class="space-y-2">
                            <NuxtLink
                                v-for="file in results.attachments"
                                :key="`a${file.id}`"
                                :to="`/board/${file.boardId}?card=${file.cardId}`"
                                @click="follow"
                                class="block rounded-lg p-1 hover:bg-primary/10"
                            >
                                <!-- The attachment row from the card modal. -->
                                <span
                                    class="flex w-full items-center gap-2 rounded-xl bg-dark/10 px-3 py-2 text-dark dark:bg-white/10 dark:text-white"
                                >
                                    <Paperclip class="size-4 shrink-0 text-gray" />
                                    <span class="min-w-0 truncate"
                                        ><Highlight
                                            :text="file.filename"
                                            :term="query"
                                    /></span>
                                </span>
                                <span
                                    class="mt-1.5 block px-1 text-xs text-gray"
                                    >{{ file.cardName }} ·
                                    {{ file.boardName }}</span
                                >
                            </NuxtLink>
                        </div>
                    </section>
                </div>
            </div>
        </Teleport>
    </div>
</template>

<script setup lang="ts">
import {
    Search,
    Paperclip,
    Check,
    ListChecks,
    MessageSquareText,
    Clock,
} from "lucide-vue-next";

// Dates render in the instance's timezone and language, like everywhere else.
const { formatServerDate } = useServerDate();

// Mirrors the card tile: the same fields, the same short format, and the same
// emphasis on a due date that has passed.
const cardHasMeta = (card: any) =>
    card.checklist?.total ||
    card.commentCount ||
    card.attachmentCount ||
    card.dueDate ||
    card.assignee;

const isOverdue = (dueDate: string) =>
    !!dueDate && new Date(dueDate).getTime() < Date.now();

const dueDateLabel = (dueDate: string) =>
    formatServerDate(dueDate, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    });

const props = defineProps({
    // "inline" is the header field. "modal" is the same search inside a dialog,
    // which is how a phone gets at it: there is no room in the header for a
    // field that can be typed into, and a full-width row underneath the nav
    // pushed the boards down the page on every screen.
    variant: { type: String, default: "inline" },
    // Whether the dialog holding it is open. Only read in the modal variant,
    // where it clears the last search on the way out — reopening the dialog to
    // find the previous query and its results still sitting there reads as a
    // dialog that failed to close.
    active: { type: Boolean, default: false },
});

const inModal = computed(() => props.variant === "modal");

const root = ref(null);
const input = ref(null);
// The placeholder element, and whether the text in it is longer than the box it
// has to fit in. `scrollWidth > clientWidth` on a `nowrap`/`overflow-hidden`
// element is a fact the browser reports about what it drew, so no font, no
// language and no browser font setting can make it wrong.
const hint = ref<HTMLElement | null>(null);
const hintOverflows = ref(false);

// How wide the field would have to be for this placeholder to fit exactly: the
// text as it is actually laid out, plus the room the icon and the padding take.
// The header caps the field at this, so English does not get German's width and
// French is not cut short of its own — see `--search-max` in AppHeader.
const natural = ref(0);

const measureHint = () => {
    const el = hint.value;
    if (!el) return;
    hintOverflows.value = el.scrollWidth > el.clientWidth;

    // A range over the text rather than the element's own width: the element is
    // the size of the box it has to fit in, and once the text is longer than
    // that the box stops telling us anything about the text. A range measures
    // what was laid out, clipped or not.
    const field = input.value as HTMLInputElement | null;
    if (!field) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    const text = range.getBoundingClientRect().width;
    range.detach();
    if (!text) return;

    const style = getComputedStyle(field);
    natural.value = Math.ceil(
        text +
            parseFloat(style.paddingLeft) +
            parseFloat(style.paddingRight) +
            2, // the label's border, one pixel each side
    );
};
const panel = ref(null);
const panelStyle = ref({});

const term = ref("");
// A result has been clicked and its page is on its way.
const following = ref(false);
const loading = ref(false);
const results = ref({ boards: [], cards: [], comments: [], attachments: [] });
// The term the results belong to, so the highlight never lags behind or runs
// ahead of what's on screen.
const query = ref("");
const dismissed = ref(false);

const needle = computed(() => term.value.trim());
const total = computed(
    () =>
        results.value.boards.length +
        results.value.cards.length +
        results.value.comments.length +
        results.value.attachments.length,
);
// Anything worth showing: results, a message, or the "keep typing" hint.
const showPanel = computed(() => !dismissed.value && needle.value.length > 0);

const MARGIN = 16;
const MAX_WIDTH = 520;

// Anchored under the field and clamped to the viewport, measured against
// `clientWidth` so a classic scrollbar can't push it off the edge.
const positionPanel = () => {
    const anchor = root.value as HTMLElement | null;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const available = document.documentElement.clientWidth;
    const width = Math.min(
        Math.max(rect.width, 320),
        MAX_WIDTH,
        available - MARGIN * 2,
    );
    const left = Math.min(
        Math.max(rect.left, MARGIN),
        available - width - MARGIN,
    );
    panelStyle.value = {
        top: `${rect.bottom + 8}px`,
        left: `${left}px`,
        width: `${width}px`,
    };
};

const close = () => {
    dismissed.value = true;
};

// Following a result used to close the panel on the click itself, which emptied
// it the moment it was pressed and then left the reader looking at nothing —
// an empty dialog, or a blank strip under the field — for as long as the page
// took to arrive. The results stay up instead, and the arrival closes them: the
// list is the last thing worth looking at while the board loads, and it also
// makes the wait legible, because the thing that was clicked is still there.
const route = useRoute();
const router = useRouter();
const emit = defineEmits(["navigate"]);

const follow = (event: MouseEvent) => {
    const href = (event.currentTarget as HTMLAnchorElement)?.getAttribute("href");
    // Already on the page the result points at: nothing will change, and no
    // route watcher will fire, so finish here rather than waiting for a
    // navigation that the router will discard as a duplicate.
    if (href && router.resolve(href).fullPath === route.fullPath) {
        close();
        emit("navigate");
        return;
    }
    following.value = true;
};

watch(
    () => route.fullPath,
    () => {
        following.value = false;
        close();
        // The dialog closes with the page it opened, in the modal variant.
        emit("navigate");
    },
);
// Coming back to the field after dismissing should bring the results back
// rather than requiring another keystroke. Click as well as focus: pressing
// Escape doesn't blur the field, so a later click fires no focus event.
const reopen = () => {
    dismissed.value = false;
};

const clear = () => {
    results.value = { boards: [], cards: [], comments: [], attachments: [] };
    query.value = "";
};

watch(
    () => props.active,
    (open) => {
        if (!inModal.value) return;
        if (open) {
            dismissed.value = false;
        } else {
            term.value = "";
            clear();
        }
    },
);

// The header focuses the field itself, in the click that opens the dialog. The
// dialog is always in the DOM (it animates in and out rather than mounting), so
// this runs inside the original gesture — which is what iOS requires before it
// will raise the keyboard. A focus deferred to a watcher or a `nextTick` is no
// longer that gesture, and the field would come up with no keyboard.
const focus = () => (input.value as HTMLInputElement | null)?.focus();
defineExpose({ focus });

// Typing searches as you go: debounced so a fast typist causes one request
// rather than one per keystroke, and sequenced so a slow earlier response can
// never overwrite the results of a later one.
let debounce: ReturnType<typeof setTimeout> | undefined;
let latest = 0;

watch(term, (value) => {
    clearTimeout(debounce);
    dismissed.value = false;
    if (value.trim().length < 2) {
        loading.value = false;
        clear();
        return;
    }
    loading.value = true;
    debounce = setTimeout(async () => {
        const request = ++latest;
        try {
            const res: any = await $fetch(
                `/api/data/search?q=${encodeURIComponent(value.trim())}`,
            );
            if (request !== latest) return;
            results.value = {
                boards: res?.boards ?? [],
                cards: res?.cards ?? [],
                comments: res?.comments ?? [],
                attachments: res?.attachments ?? [],
            };
            query.value = res?.query ?? value.trim();
        } catch (err) {
            if (request === latest) clear();
            console.error("Search failed:", err);
        } finally {
            if (request === latest) loading.value = false;
        }
    }, 200);
});

// Dismissing on a click outside is the inline field's job: it hangs over the
// page and has to get out of the way. In the dialog the backdrop already does
// that, and this would close the results on any click inside the card.
const handleOutsideClick = (event: MouseEvent) => {
    const target = event.target as Node;
    if (
        (root.value as HTMLElement | null)?.contains(target) ||
        (panel.value as HTMLElement | null)?.contains(target)
    )
        return;
    close();
};

watch(showPanel, async (open) => {
    if (inModal.value) return;
    if (open) {
        await nextTick();
        positionPanel();
        window.addEventListener("scroll", positionPanel, {
            passive: true,
            capture: true,
        });
        window.addEventListener("resize", positionPanel, { passive: true });
        document.addEventListener("click", handleOutsideClick);
    } else {
        window.removeEventListener("scroll", positionPanel, true);
        window.removeEventListener("resize", positionPanel);
        document.removeEventListener("click", handleOutsideClick);
    }
});

// Re-checked whenever the box or the text can have changed: the field resizes
// with the window, the webfont settles after first paint, the placeholder
// arrives with the locale, and the element itself comes and goes as the field
// is typed into and cleared.
let hintResize: ResizeObserver | undefined;
let hintText: MutationObserver | undefined;

const stopWatchingHint = () => {
    hintResize?.disconnect();
    hintText?.disconnect();
};

watch(hint, async (el) => {
    stopWatchingHint();
    if (!el) return;
    await nextTick();
    measureHint();
    // The box: the field is `flex-1`, so it changes with the window.
    hintResize = new ResizeObserver(measureHint);
    hintResize.observe(el);
    // And the text: the placeholder arrives with the locale, which is applied
    // by a plugin after this has mounted. Watching the box alone missed that —
    // the box does not change when the sentence inside it does, so a language
    // whose placeholder does not fit kept the one before it had decided.
    hintText = new MutationObserver(measureHint);
    hintText.observe(el, { childList: true, characterData: true, subtree: true });
});

onMounted(() => {
    measureHint();
    document.fonts?.ready?.then(measureHint).catch(() => {});
});

onBeforeUnmount(() => {
    stopWatchingHint();
    clearTimeout(debounce);
    window.removeEventListener("scroll", positionPanel, true);
    window.removeEventListener("resize", positionPanel);
    document.removeEventListener("click", handleOutsideClick);
});
</script>
