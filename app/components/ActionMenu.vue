<template>
    <div class="relative">
        <button
            ref="trigger"
            type="button"
            @click="open = !open"
            :aria-expanded="open"
            aria-haspopup="menu"
            v-tooltip="props.tooltip"
            class="flex cursor-pointer items-center justify-center"
            :class="
                plain
                    ? 'action-menu-plain size-7 rounded-md transition-colors'
                    : 'size-12 rounded-full bg-primary/10 text-primary hover:bg-primary hover:text-white dark:bg-white/10 dark:text-white'
            "
        >
            <MoreVertical class="size-5" />
        </button>

        <!-- `floating` moves both the catcher and the panel into <body>, for a
             menu that opens inside something that clips its contents — a board
             tile, whose `overflow-clip` keeps the cover image inside its rounded
             corners and would take the top off the menu with it. Positioned
             against the button rather than laid out beside it, the same way the
             search results are. -->
        <Teleport to="body" :disabled="!floating">
            <template v-if="open">
                <!-- Full-screen catcher: a click anywhere outside closes the
                     menu. Above the board tiles (which paint their content at
                     z-20) so an outside click always lands here first. -->
                <div class="fixed inset-0 z-40" @click="open = false"></div>
                <!-- Clicking any item closes the menu (@click on the panel). z-50
                     so it sits above the board tiles' z-20 content. -->
                <div
                    ref="panel"
                    role="menu"
                    :style="floating ? panelStyle : undefined"
                    class="z-50 min-w-52 rounded-xl border border-gray/15 bg-white p-1 shadow-lg dark:border-white/15 dark:bg-slate"
                    :class="floating ? 'fixed' : 'absolute right-0 mt-2'"
                    @click="open = false"
                >
                    <slot />
                </div>
            </template>
        </Teleport>
    </div>
</template>
<script setup lang="ts">
import { MoreVertical } from "@lucide/vue";

const props = defineProps({
    tooltip: String,
    // The button without its filled circle, for places that cannot carry a
    // 48-pixel control: beside a card's title, where it stands in for what used
    // to be a bare delete icon and has to keep that weight. The menu it opens
    // is the same one the board and dashboard headers open.
    plain: Boolean,
    // Render the menu in <body>, positioned against the button. For menus that
    // open inside a box that clips what overflows it.
    floating: Boolean,
});

const open = ref(false);
const trigger = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const panelStyle = ref<Record<string, string>>({});

// Under the button and aligned to its right edge, clamped so it can never hang
// off the side of the window — on a phone the button is near the right edge and
// the menu is wider than the space left beside it.
const MARGIN = 8;
const position = () => {
    if (!props.floating) return;
    const button = trigger.value;
    const menu = panel.value;
    if (!button || !menu) return;
    const rect = button.getBoundingClientRect();
    const width = menu.offsetWidth;
    const available = document.documentElement.clientWidth;
    const left = Math.min(
        Math.max(rect.right - width, MARGIN),
        available - width - MARGIN,
    );
    panelStyle.value = { top: `${rect.bottom + MARGIN}px`, left: `${left}px` };
};

watch(open, async (isOpen) => {
    if (!props.floating) return;
    if (isOpen) {
        await nextTick();
        position();
        window.addEventListener("scroll", position, {
            passive: true,
            capture: true,
        });
        window.addEventListener("resize", position, { passive: true });
    } else {
        window.removeEventListener("scroll", position, true);
        window.removeEventListener("resize", position);
    }
});

// Close on Escape for keyboard users.
const onKey = (e) => {
    if (e.key === "Escape") open.value = false;
};
onMounted(() => document.addEventListener("keydown", onKey));
onBeforeUnmount(() => {
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("scroll", position, true);
    window.removeEventListener("resize", position);
});
</script>
