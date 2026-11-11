<template>
    <div>
        <div class="bg-white dark:bg-slate p-5 rounded-xl flex items-center">
            <div class="grow shrink">
                <p class="text-primary">
                    <span class="inline-block mr-2">{{ props.name }}</span>
                    <span class="inline-block bg-primary/10 rounded-lg px-2"
                        >{{ props.start }}...**</span
                    >
                </p>
                <div class="text-sm flex items-center gap-x-1 mt-1">
                    <Timer class="size-4 shrink-0 grow-0" />
                    <div class="grow shrink">{{ formattedExpires }}</div>
                </div>
            </div>
            <div class="w-12">
                <button
                    type="button"
                    class="size-12 bg-primary text-white hover:bg-primary-hover rounded-full flex justify-center items-center"
                    @click="openDeleteKeyModal"
                    v-tooltip="$t('delete')"
                >
                    <Trash2 class="size-5" />
                </button>
            </div>
        </div>
        <ModalWindow v-model="deleteKeyModal">
            <h2 class="text-4xl text-dark dark:text-white mb-3">
                {{ $t("deleteKeyHeadline") }}
            </h2>
            <p class="mb-6">{{ $t("deleteKeyText") }}</p>
            <button
                @click="deleteKey()"
                type="button"
                class="button bg-primary hover:bg-primary-hover w-full text-center px-6 py-3 rounded-lg text-white cursor-pointer"
            >
                {{ $t("deleteKeyButton") }}
            </button>
        </ModalWindow>
    </div>
</template>
<script setup lang="ts">
import { Timer, Trash2 } from "@lucide/vue";

const props = defineProps({
    id: String,
    name: String,
    start: String,
    expires: Date,
});

const nuxtApp = useNuxtApp();
const emits = defineEmits(["key-deleted"]);

const deleteKeyModal = ref(false);

const formattedExpires = computed(() => {
    if (!props.expires) return "";
    return new Intl.DateTimeFormat("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    }).format(props.expires);
});

const openDeleteKeyModal = () => {
    deleteKeyModal.value = true;
    setBodyScrollLock(true);
};

const deleteKey = async () => {
    const keyId = props.id;
    try {
        const response = await $fetch("/api/auth/api-key/delete", {
            method: "POST",
            body: {
                keyId: keyId,
            },
        });

        if (response.success) {
            deleteKeyModal.value = false;
            setBodyScrollLock(false);
            emits("key-deleted", keyId);
            await nuxtApp.callHook("app:toast", {
                message: $t("keyDeleted"),
            });
        } else {
            throw new Error(response.error || "Failed to delete API key");
        }
    } catch (e) {
        let errorMessage = "Failed to delete API key";
        if (e?.data?.error) {
            errorMessage = e.data.error;
        } else if (e?.message) {
            errorMessage = e.message;
        }

        await nuxtApp.callHook("app:toast", {
            message: errorMessage,
        });
    }
};
</script>
