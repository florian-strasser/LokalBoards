<template>
    <div>
        <!-- First-run prompt -->
        <div
            v-if="promptVisible"
            class="fixed inset-0 z-[70] flex items-center justify-center p-4"
        >
            <div class="absolute inset-0 bg-black/50" @click="skip" />
            <div
                class="relative w-full max-w-md bg-white dark:bg-slate rounded-xl shadow-xl p-8 text-center"
            >
                <h2 class="text-3xl text-dark dark:text-white mb-3">
                    {{ $t("onboardingPromptTitle") }}
                </h2>
                <p class="text-gray mb-6">
                    {{ $t("onboardingPromptText") }}
                </p>
                <div class="flex flex-col gap-3">
                    <button
                        type="button"
                        @click="start"
                        class="button bg-primary hover:bg-primary-hover w-full px-6 py-3 rounded-lg text-white"
                    >
                        {{ $t("onboardingStart") }}
                    </button>
                    <button
                        type="button"
                        @click="skip"
                        class="text-gray hover:text-primary-hover"
                    >
                        {{ $t("onboardingSkip") }}
                    </button>
                </div>
            </div>
        </div>

        <!-- Highlight ring around the current step's target -->
        <div
            v-if="active && rect"
            class="onboarding-ring pointer-events-none fixed z-30 rounded-xl border-4 border-primary"
            :style="{
                top: rect.top - 6 + 'px',
                left: rect.left - 6 + 'px',
                width: rect.width + 12 + 'px',
                height: rect.height + 12 + 'px',
            }"
        />

        <!-- Instruction card (anchored next to the highlighted target so it
             doesn't collide with a centered modal) -->
        <div
            v-if="active && stepText"
            ref="cardRef"
            class="fixed z-30 w-[calc(100%-2rem)] max-w-sm bg-white dark:bg-slate rounded-xl shadow-xl border border-primary/30 dark:border-white/15 p-5 text-left"
            :style="cardStyle"
        >
            <div class="flex items-start gap-3">
                <div class="grow">
                    <div class="text-xs text-primary font-semibold mb-1">
                        {{
                            $t("onboardingProgress", {
                                current: stepIndex + 1,
                                total: totalSteps,
                            })
                        }}
                    </div>
                    <p class="text-dark dark:text-white">{{ stepText }}</p>
                </div>
                <button
                    type="button"
                    @click="cancel"
                    class="shrink-0 text-gray hover:text-primary-hover"
                    v-tooltip="$t('onboardingCancel')"
                >
                    <X class="size-5" />
                </button>
            </div>
        </div>
    </div>
</template>
<script setup lang="ts">
import { X } from "@lucide/vue";
import { ONBOARDING_STEPS } from "~/composables/useOnboarding";

const { active, step, promptVisible, start, skip, cancel } = useOnboarding();

const totalSteps = ONBOARDING_STEPS.length;

// Map each step to the element it highlights and the instruction text.
const STEP_META: Record<string, { selector: string; textKey: string }> = {
    "create-board": {
        selector: '[data-onboarding="new-board"]',
        textKey: "onboardingStepBoard",
    },
    "create-areas": {
        selector: '[data-onboarding="new-area"]',
        textKey: "onboardingStepAreas",
    },
    "add-card": {
        selector: '[data-onboarding="new-card"]',
        textKey: "onboardingStepCard",
    },
    "move-card": {
        selector: '[data-onboarding="areas"]',
        textKey: "onboardingStepMove",
    },
    invite: {
        selector: '[data-onboarding="invite"]',
        textKey: "onboardingStepInvite",
    },
};

const stepIndex = computed(() =>
    ONBOARDING_STEPS.indexOf(step.value as any),
);
const stepText = computed(() => {
    const meta = STEP_META[step.value];
    return meta ? $t(meta.textKey) : "";
});

const rect = ref<DOMRect | null>(null);
const cardRef = ref<HTMLElement | null>(null);
const cardPos = ref<{ top: number; left: number } | null>(null);

// Place the instruction card next to the target: below it if there's room,
// otherwise above, clamped inside the viewport. Falls back to a bottom corner
// when there's no target on the current page.
const computeCardPos = () => {
    const r = rect.value;
    const card = cardRef.value;
    if (!r || !card) {
        cardPos.value = null;
        return;
    }
    const cw = card.offsetWidth || 360;
    const ch = card.offsetHeight || 140;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 12;
    let top = r.bottom + gap;
    if (top + ch + 8 > vh) top = r.top - ch - gap; // not enough room below
    top = Math.max(8, Math.min(top, vh - ch - 8));
    const left = Math.max(8, Math.min(r.left, vw - cw - 8));
    cardPos.value = { top, left };
};

const cardStyle = computed(() =>
    cardPos.value
        ? { top: `${cardPos.value.top}px`, left: `${cardPos.value.left}px` }
        : { bottom: "1.5rem", left: "1rem" },
);

const updateRect = () => {
    if (!active.value) {
        rect.value = null;
        cardPos.value = null;
        return;
    }
    const meta = STEP_META[step.value];
    const el = meta
        ? (document.querySelector(meta.selector) as HTMLElement | null)
        : null;
    rect.value = el ? el.getBoundingClientRect() : null;
    computeCardPos();
};

// The target can appear, move or reflow (areas added, page navigated), so keep
// the ring in sync with a light poll plus scroll/resize while the tour runs.
let poll: ReturnType<typeof setInterval> | null = null;
const startPolling = () => {
    if (poll) return;
    poll = setInterval(updateRect, 250);
    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("resize", updateRect);
};
const stopPolling = () => {
    if (poll) clearInterval(poll);
    poll = null;
    window.removeEventListener("scroll", updateRect, true);
    window.removeEventListener("resize", updateRect);
    rect.value = null;
};

watch(
    () => active.value,
    (on) => {
        if (on) {
            nextTick(updateRect);
            startPolling();
        } else {
            stopPolling();
        }
    },
);
watch(() => step.value, () => nextTick(updateRect));

onBeforeUnmount(stopPolling);
</script>
