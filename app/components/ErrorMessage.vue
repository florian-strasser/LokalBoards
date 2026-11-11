<template>
    <div
        class="bg-primary/10 border border-primary text-primary px-6 py-5 rounded-lg"
    >
        <div class="flex">
            <CircleAlert class="size-8 shrink-0 grow-0" />
            <div class="shrink grow pt-1 ml-2">
                <slot />
            </div>
        </div>
    </div>
</template>
<script setup lang="ts">
import { CircleAlert } from "@lucide/vue";
</script>
