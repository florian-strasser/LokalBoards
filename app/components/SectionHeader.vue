<template>
    <div class="flex justify-between mb-8">
        <h1 v-if="!props.asH2" class="text-3xl sm:text-5xl text-dark dark:text-white">
            <slot />
        </h1>
        <h2 v-else class="text-3xl sm:text-5xl text-dark dark:text-white"><slot /></h2>
        <!-- Optional extra action buttons rendered to the left of the primary
             (+) button — e.g. the dashboard's "import from Trello". -->
        <div class="flex shrink-0 items-center gap-3">
            <slot name="actions" />
            <button
                v-if="props.asButton"
                type="button"
                :data-onboarding="props.onboardingTarget || undefined"
                class="size-12 bg-primary text-white hover:bg-primary-hover flex justify-center items-center rounded-full"
                @click="handleClick"
                v-tooltip="props.tooltip"
            >
                <Plus class="size-5" />
            </button>
            <NuxtLink
                v-if="!props.asButton && props.url"
                :to="props.url"
                class="size-12 bg-primary text-white hover:bg-primary-hover flex justify-center items-center rounded-full"
                v-tooltip="props.tooltip"
                ><Plus class="size-5"
            /></NuxtLink>
        </div>
    </div>
</template>
<script setup lang="ts">
import { Plus } from "@lucide/vue";

const emit = defineEmits(["section-header-button-clicked"]);

const props = defineProps({
    url: String,
    asButton: Boolean,
    tooltip: String,
    asH2: Boolean,
    onboardingTarget: String,
});

const handleClick = () => {
    emit("section-header-button-clicked");
};
</script>
