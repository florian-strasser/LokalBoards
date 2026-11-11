<template>
    <div class="relative">
        <button
            type="button"
            @click="open = !open"
            :aria-expanded="open"
            aria-haspopup="listbox"
            class="form-control form-control-select w-full cursor-pointer truncate text-left"
        >
            {{ selectedLabel }}
        </button>

        <template v-if="open">
            <!-- Full-screen catcher: a click anywhere outside closes the menu. -->
            <div class="fixed inset-0 z-10" @click="open = false"></div>
            <ul
                role="listbox"
                class="absolute inset-x-0 z-20 mt-1 max-h-64 overflow-auto rounded-[0.625rem] border border-gray/15 bg-white py-1 shadow-lg dark:bg-slate"
            >
                <li v-for="opt in props.options" :key="opt.value">
                    <button
                        type="button"
                        role="option"
                        :aria-selected="opt.value === model"
                        @click="select(opt.value)"
                        class="flex w-full cursor-pointer items-center justify-between gap-2 px-3.5 py-2 text-left text-sm transition-colors hover:bg-primary/10"
                        :class="
                            opt.value === model
                                ? 'font-medium text-primary'
                                : 'text-dark dark:text-white'
                        "
                    >
                        <span class="truncate">{{ opt.label }}</span>
                        <Check v-if="opt.value === model" class="size-4 shrink-0" />
                    </button>
                </li>
            </ul>
        </template>
    </div>
</template>
<script setup lang="ts">
import { Check } from "@lucide/vue";

const model = defineModel();
const props = defineProps({
    options: { type: Array, default: () => [] },
});

const open = ref(false);
const select = (value) => {
    model.value = value;
    open.value = false;
};

const selectedLabel = computed(() => {
    const found = props.options.find((o) => o.value === model.value);
    return found ? found.label : "";
});

// Close on Escape for keyboard users.
const onKey = (e) => {
    if (e.key === "Escape") open.value = false;
};
onMounted(() => document.addEventListener("keydown", onKey));
onBeforeUnmount(() => document.removeEventListener("keydown", onKey));
</script>
