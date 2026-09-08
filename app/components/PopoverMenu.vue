<template>
    <div ref="root" class="relative">
        <div @click="toggle">
            <slot name="trigger" :open="open" />
        </div>
        <!-- The panel is rendered into <body> and positioned in JS, not as a
             child of the trigger. As a child it was `absolute` inside whatever
             scrolls around it — on a card that is the dialog's own scroll
             container — so a panel taller than the card stuck out past the
             bottom of it, was clipped there, and gave the card a scrollbar it
             had no reason to have. The tooltip directive is out in the body for
             the same reason; this is the same problem one component along. -->
        <Teleport to="body">
            <div
                v-if="open"
                ref="panel"
                :style="panelStyle"
                class="fixed z-50 overflow-y-auto rounded-xl border border-gray/20 dark:border-white/15 bg-white dark:bg-slate shadow-xl p-4 text-left"
            >
                <slot :close="close" />
            </div>
        </Teleport>
    </div>
</template>
<script setup lang="ts">
// A lightweight click-to-open popover used for the Trello-style card metadata
// menus. Closes on an outside click or Escape. The default slot receives a
// `close` function so menu items can dismiss it after acting.
const props = defineProps({
    align: { type: String, default: "left" },
});

const open = ref(false);
const root = ref(null);
const panel = ref(null);
const panelStyle = ref({});

const GAP = 8; // px between the trigger and the panel
const MARGIN = 8; // keep this much clear of every viewport edge

// Place the panel under its trigger, then keep it on screen: pushed back inside
// the horizontal edges, flipped above when there is more room up there than
// down here, and finally capped in height so a long list scrolls inside the
// panel rather than running off the bottom of the window.
const position = () => {
    const trigger = root.value;
    const el = panel.value;
    if (!trigger || !el) return;

    const rect = trigger.getBoundingClientRect();
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;

    let left = props.align === "right" ? rect.right - width : rect.left;
    left = Math.min(Math.max(left, MARGIN), viewportWidth - width - MARGIN);

    const below = viewportHeight - rect.bottom - GAP - MARGIN;
    const above = rect.top - GAP - MARGIN;
    const goesAbove = height > below && above > below;

    const top = goesAbove
        ? Math.max(rect.top - GAP - height, MARGIN)
        : rect.bottom + GAP;

    panelStyle.value = {
        top: `${top}px`,
        left: `${left}px`,
        maxHeight: `${Math.max(goesAbove ? above : below, 120)}px`,
    };
};

const toggle = async () => {
    open.value = !open.value;
    if (open.value) {
        // Measured after it exists, and again on the next frame: the slot's
        // own content decides the size, and something inside it may still be
        // laying out on the first pass.
        await nextTick();
        position();
        requestAnimationFrame(position);
    }
};
const close = () => (open.value = false);

// The panel is no longer inside the trigger's subtree, so "outside" has to mean
// outside both of them — otherwise the first click in the panel closes it.
const onDocMouseDown = (e) => {
    if (!open.value) return;
    if (root.value?.contains(e.target)) return;
    if (panel.value?.contains(e.target)) return;
    close();
};
const onKeydown = (e) => {
    // Swallow the Escape so it closes the popover without also closing the
    // surrounding card modal.
    if (e.key === "Escape" && open.value) {
        e.stopPropagation();
        close();
    }
};

// A fixed panel would otherwise stay where the trigger used to be.
const onReflow = () => {
    if (open.value) position();
};

// The slot's contents change height as they are used — a form opening inside
// the labels panel, a list growing — and the panel has to be measured again
// when they do.
let observer = null;
watch(panel, (el) => {
    observer?.disconnect();
    observer = null;
    if (el && typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(onReflow);
        observer.observe(el);
    }
});

onMounted(() => {
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeydown);
    window.addEventListener("scroll", onReflow, { passive: true, capture: true });
    window.addEventListener("resize", onReflow, { passive: true });
});
onBeforeUnmount(() => {
    document.removeEventListener("mousedown", onDocMouseDown);
    document.removeEventListener("keydown", onKeydown);
    window.removeEventListener("scroll", onReflow, true);
    window.removeEventListener("resize", onReflow);
    observer?.disconnect();
});
</script>
