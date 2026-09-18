<template>
    <!-- `h-dvh`, not `h-screen`: on a phone `100vh` is the viewport as it would
         be with the browser's own bars out of the way, so the foot of a dialog
         sat behind Safari's address bar — and which end was swallowed depended
         on whether that bar was set to the top or the bottom of the screen. The
         dynamic viewport is what is actually visible. The page behind is
         scroll-locked while a dialog is open, so the bars cannot slide away
         underneath it and change that height mid-read. -->
    <!-- The space around the card closes it, but only when the whole press
         happened there: selecting text inside the card and letting go beside
         it is reported as a click on that space too (see `pressTracker`). -->
    <div
        :class="{ 'transform translate-x-full': !visible }"
        class="fixed top-0 left-0 w-full h-dvh z-40 flex flex-col justify-center overflow-hidden"
        @pointerdown="press.down"
        @pointerup="press.up"
    >
        <motion.div
            class="modal-backdrop absolute top-0 left-0 w-full h-full"
            :style="{ opacity: backdropOpacity }"
            @click="closeFromOutside"
        />
        <!-- The whole card scrolls (not an inner region). The enter/exit
             transform sits on THIS element, not on the card inside it: this is
             the scroll container, so its padding edge is the clip boundary, and
             a card animating past it would simply be cut off. Moving the
             container instead carries its contents along untouched. -->
        <!-- Below `sm` the card is the width of the window, edge to edge, and
             it is its own `p-8` — `.container`'s `2rem`, to the pixel — that
             lines its contents up with the page behind it. A card inset to the
             container instead would have been aligned and 64 px narrower, and
             on a phone that width is the whole point: it is where the title,
             the attachment names and the comments have to fit.
             
             What it must never be is the third thing, which is what it was: a
             card capped at `max-w-lg` and centred, sitting a few pixels wider
             than the column on each side — too close to the tiles to read as a
             margin, too far off to read as alignment.

             From `sm` up there is room for a real dialog, so it becomes one:
             `max-w-lg`, centred, with the container's padding around it. That
             centring is on the page's axis, not the window's — the dialog is
             fixed, so its box is the whole window including the strip the
             scrollbar occupied, which the locked page no longer covers, and
             half that width is how far the card used to sit to the right of
             everything behind it. `--scrollbar-gap` is what the lock reserved
             (see `bodyScrollLock`), added to the padding on that side. -->
        <motion.div
            class="relative w-full max-h-full py-8 overflow-y-auto overflow-x-hidden sm:pl-8 sm:pr-[calc(2rem+var(--scrollbar-gap,0px))]"
            :style="{ y, opacity: cardOpacity }"
            @click="closeFromOutside"
        >
            <div class="relative w-full sm:max-w-lg mx-auto">
                <div
                    class="absolute top-0 right-0 w-12 transform sm:translate-x-1/2 -translate-y-1/2 z-30"
                >
                    <button
                        type="button"
                        @click="closeModal"
                        class="flex justify-center items-center bg-primary text-white hover:bg-primary-hover size-12 rounded-full"
                    >
                        <X class="size-5" stroke-width="2" />
                    </button>
                </div>
                <div
                    class="bg-white dark:bg-slate shadow-xl p-8 rounded-lg text-gray text-center"
                >
                    <slot />
                </div>
            </div>
        </motion.div>
    </div>
</template>
<script setup lang="ts">
import { X } from "lucide-vue-next";
import { motion, useMotionValue, animate } from "motion-v";

const props = defineProps({
    hideClose: Boolean,
});

const open = defineModel();


// Enter: card rises from below (y 32 → 0) and fades in; the backdrop fades in.
// Exit: card continues upward (0 → -32) and fades out; the backdrop fades out.
// Driven imperatively so the start position resets on every open (a single
// reactive :animate can't re-enter from the bottom after exiting upward).
const ENTER_Y = 32;
const EXIT_Y = -32;
const DURATION = 0.4;
// The card fades out in a little over half the time the backdrop takes.
const CARD_EXIT_DURATION = 0.22;
const EASE = [0.22, 1, 0.36, 1];
const y = useMotionValue(ENTER_Y);
const cardOpacity = useMotionValue(0);
const backdropOpacity = useMotionValue(0);
// Keep the modal in the DOM/on-screen through the exit animation.
const visible = ref(false);
let hideTimer;

const applyState = (isOpen, animated) => {
    clearTimeout(hideTimer);
    if (isOpen) {
        visible.value = true;
        if (animated) {
            y.set(ENTER_Y);
            cardOpacity.set(0);
            animate(y, 0, { duration: DURATION, ease: EASE });
            animate(cardOpacity, 1, { duration: DURATION, ease: EASE });
            animate(backdropOpacity, 1, { duration: DURATION, ease: EASE });
        } else {
            // Shown immediately (e.g. a card opened straight from the URL).
            y.set(0);
            cardOpacity.set(1);
            backdropOpacity.set(1);
        }
    } else if (animated && visible.value) {
        // The card leaves faster than the backdrop. A scrolled dialog is clipped
        // to a hard-edged rectangle by its scroll container, and if it were still
        // faintly visible once the backdrop had gone it would read as a torn-off
        // fragment floating over the board. Fading it out first means the board
        // is still dimmed for as long as any of the card can be seen.
        animate(y, EXIT_Y, { duration: DURATION, ease: EASE });
        animate(cardOpacity, 0, { duration: CARD_EXIT_DURATION, ease: EASE });
        animate(backdropOpacity, 0, { duration: DURATION, ease: EASE });
        hideTimer = setTimeout(() => (visible.value = false), DURATION * 1000);
    } else {
        visible.value = false;
        y.set(ENTER_Y);
        cardOpacity.set(0);
        backdropOpacity.set(0);
    }
};

// Set the initial state without animating; animate on later changes.
onMounted(() => applyState(!!open.value, false));
watch(
    () => open.value,
    (isOpen) => applyState(isOpen, true),
);

// Register this modal in the shared open-count so the rest of the app can lock
// the page behind it. Lock body scroll whenever any modal is open.
const modal = useModalOpen();
let counted = false;
const syncCount = (isOpen) => {
    if (isOpen && !counted) {
        modal.add();
        counted = true;
    } else if (!isOpen && counted) {
        modal.remove();
        counted = false;
    }
};
// Driven by `visible`, not `open`: the modal stays on screen through its exit
// animation, so releasing the lock the moment `open` flips restores the page's
// scrollbar while the modal's own one is still there — two scrollbars for the
// length of the animation.
watch(() => visible.value, syncCount, { immediate: true });
watch(
    modal.isOpen,
    (locked) => {
        if (import.meta.client) {
            setBodyScrollLock(locked);
        }
    },
    { immediate: true },
);

const handleEscKey = (event) => {
    if (event.key === "Escape") {
        closeModal();
    }
};

const closeModal = () => {
    open.value = false;
};

// Asked of the element the handler sits on, not merely "somewhere outside the
// card": a dialog opened inside this one's card has a backdrop of its own, and
// a click there bubbles up through this one's surfaces as well.
const press = createPressTracker();
const closeFromOutside = (event) => {
    const surface = event.currentTarget;
    if (press.stayed(event, (target) => target === surface)) closeModal();
};

onMounted(() => {
    window.addEventListener("keydown", handleEscKey);
});

onUnmounted(() => {
    syncCount(false);
    window.removeEventListener("keydown", handleEscKey);
});
</script>
