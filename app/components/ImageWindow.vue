<template>
    <!-- Teleported to <body> so its fixed positioning is relative to the
         viewport even when rendered inside a transformed modal. -->
    <Teleport to="body">
        <!-- z-50, one step above ModalWindow's z-40. The lightbox is always
             opened *from* something — usually a card modal — so it has to sit
             above it. Sharing z-40 left the two tied, and Vue teleports these
             roots ahead of `#__nuxt` in <body>, so the tie broke the wrong way:
             an image opened from a card rendered behind that card. -->
        <div
            v-show="visible"
            class="fixed inset-0 z-50 flex items-center justify-center"
        >
            <div
                class="absolute inset-0 bg-black/60 transition-opacity duration-300 ease-out"
                :class="shown ? 'opacity-100' : 'opacity-0'"
                @click="closeModal"
            />
            <div
                class="relative flex h-full w-full items-center justify-center p-6 sm:p-10"
                @click="closeModal"
            >
                <img
                    v-if="imageSrc"
                    ref="imgEl"
                    :src="imageSrc"
                    :alt="alt || 'Image'"
                    class="max-h-full max-w-full object-contain will-change-transform"
                    :class="{ 'rounded-lg shadow-2xl': !props.bare }"
                />
                <slot />
            </div>
            <!-- The close button sits outside the element that animates, so
                 unlike ModalWindow's — which rides along inside its card — it
                 has to be faded in on its own, or it snaps into place while the
                 image is still zooming. It follows `shown` (the backdrop's own
                 signal) and borrows the image's easing and duration, so the
                 three arrive as one movement. -->
            <div
                v-if="!hideClose"
                class="absolute top-4 right-4 z-30 transition-[opacity,scale]"
                :style="{
                    transitionDuration: `${DURATION}ms`,
                    transitionTimingFunction: EASE,
                }"
                :class="shown ? 'scale-100 opacity-100' : 'scale-90 opacity-0'"
            >
                <button
                    type="button"
                    @click="closeModal"
                    class="flex size-12 items-center justify-center rounded-full bg-primary text-white hover:bg-primary-hover"
                >
                    <X class="size-5" stroke-width="2" />
                </button>
            </div>
        </div>
    </Teleport>
</template>
<script setup lang="ts">
import { X } from "@lucide/vue";

const props = defineProps({
    hideClose: Boolean,
    bare: Boolean,
    imageSrc: String,
    alt: String,
    // Screen rect { left, top, width, height } of the element the image was
    // opened from. When present the image zooms from/to it; otherwise it just
    // scales and fades from the centre.
    sourceRect: { type: Object, default: null },
});

const open = defineModel();

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const DURATION = 300;

const visible = ref(false); // kept mounted through the close animation
const shown = ref(false); // drives the backdrop fade
const imgEl = ref<HTMLImageElement | null>(null);

// Body scroll lock via the shared modal-open count (same as ModalWindow), so
// closing this on top of another modal doesn't unlock the page behind it.
const modal = useModalOpen();
let counted = false;
watch(
    modal.isOpen,
    (locked) => {
        if (import.meta.client) {
            setBodyScrollLock(locked);
        }
    },
    { immediate: true },
);

// FLIP the image between its full-size position and the source rect.
const flip = (dir: "in" | "out") => {
    const el = imgEl.value;
    if (!el) return Promise.resolve();
    // Clear any leftover animation so we measure the natural (untransformed) box.
    el.getAnimations().forEach((a) => a.cancel());

    const rect = props.sourceRect as
        | { left: number; top: number; width: number; height: number }
        | null;
    let from: Keyframe;
    let to: Keyframe;
    const target = el.getBoundingClientRect();

    if (rect && target.width > 0 && target.height > 0) {
        const collapsed = {
            transformOrigin: "top left",
            transform: `translate(${rect.left - target.left}px, ${
                rect.top - target.top
            }px) scale(${rect.width / target.width}, ${
                rect.height / target.height
            })`,
            opacity: 0.5,
        };
        const full = {
            transformOrigin: "top left",
            transform: "none",
            opacity: 1,
        };
        [from, to] = dir === "in" ? [collapsed, full] : [full, collapsed];
    } else {
        const small = { transform: "scale(0.9)", opacity: 0 };
        const normal = { transform: "none", opacity: 1 };
        [from, to] = dir === "in" ? [small, normal] : [normal, small];
    }

    const anim = el.animate([from, to], {
        duration: DURATION,
        easing: EASE,
        fill: dir === "out" ? "forwards" : "none",
    });
    return anim.finished.catch(() => {});
};

watch(
    () => open.value,
    async (isOpen) => {
        if (isOpen && !counted) {
            modal.add();
            counted = true;
        } else if (!isOpen && counted) {
            modal.remove();
            counted = false;
        }

        if (isOpen) {
            visible.value = true;
            await nextTick();
            const el = imgEl.value;
            // Wait for the image to have real dimensions before measuring.
            if (el && !el.complete) {
                await new Promise((res) =>
                    el.addEventListener("load", res, { once: true }),
                );
            }
            shown.value = true;
            flip("in");
        } else if (visible.value) {
            shown.value = false;
            await flip("out");
            visible.value = false;
        }
    },
);

const handleEscKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") closeModal();
};

const closeModal = () => {
    open.value = false;
};

onMounted(() => window.addEventListener("keydown", handleEscKey));
onUnmounted(() => {
    window.removeEventListener("keydown", handleEscKey);
    if (counted) {
        modal.remove();
        counted = false;
    }
});
</script>
