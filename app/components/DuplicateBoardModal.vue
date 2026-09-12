<template>
    <!-- Asking for the name here rather than making a "Board (copy)" to rename
         afterwards: a board is duplicated because the next one starts the same
         way, and that next one already has a name in mind. -->
    <ModalWindow v-model="isOpen">
        <h2 class="text-dark mb-3 text-4xl dark:text-white">
            {{ $t("duplicateBoard") }}
        </h2>
        <p class="mb-6">{{ $t("duplicateBoardText") }}</p>
        <form @submit.prevent="duplicate" class="space-y-5 text-left">
            <InputField
                type="text"
                :label="$t('boardName')"
                v-model="name"
                :ref="focusName"
            />
            <input
                type="submit"
                :disabled="!name.trim() || busy"
                class="bg-primary hover:bg-primary-hover disabled:opacity-60 w-full cursor-pointer rounded-lg px-6 py-3 text-center text-white"
                :value="$t('duplicateBoard')"
            />
        </form>
    </ModalWindow>
</template>

<script setup lang="ts">
const props = defineProps({
    boardID: Number,
    // The name to start from. It is selected rather than cleared, so typing
    // replaces it and keeping it is still one click away.
    sourceName: { type: String, default: "" },
});

const isOpen = defineModel<boolean>({ default: false });
const emit = defineEmits(["duplicated"]);

const nuxtApp = useNuxtApp();
const name = ref("");
const busy = ref(false);

watch(isOpen, (open) => {
    if (open) name.value = props.sourceName;
});

const focusName = (component: any) => {
    const input = component?.$el?.querySelector?.("input");
    if (!input || document.activeElement === input) return;
    input.focus();
    input.select();
};

const duplicate = async () => {
    if (!name.value.trim() || busy.value) return;
    busy.value = true;
    try {
        const response: any = await $fetch("/api/data/board-duplicate", {
            method: "POST",
            body: { boardId: props.boardID, name: name.value.trim() },
        });
        if (response?.board) {
            isOpen.value = false;
            await nuxtApp.callHook("app:toast", {
                message: $t("boardDuplicated"),
            });
            emit("duplicated", response.board);
        }
    } catch (err) {
        console.error("Could not duplicate this board:", err);
    } finally {
        busy.value = false;
    }
};
</script>
