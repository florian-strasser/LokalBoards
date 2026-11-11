<template>
    <div>
        <h2 class="text-3xl sm:text-5xl text-dark dark:text-white mt-12 mb-5">
            {{ $t("webhooks") }}
        </h2>
        <ContentBox>
            <p class="mb-5 text-sm text-gray">{{ $t("webhooksHint") }}</p>

            <ul v-if="webhooks.length" class="mb-6 space-y-3">
                <li
                    v-for="hook in webhooks"
                    :key="hook.id"
                    class="flex items-center gap-3 rounded-xl border border-gray/10 bg-light px-3 py-3 dark:bg-dark/40 sm:px-4"
                >
                    <Webhook class="size-5 shrink-0 text-gray" />
                    <div class="min-w-0 grow">
                        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span
                                class="font-semibold break-words text-dark dark:text-white"
                                >{{ hook.boardName }}</span
                            >
                            <span
                                v-if="hook.ignoreOwnActions"
                                class="shrink-0 rounded-full bg-gray/15 px-2 py-0.5 text-xs font-medium text-gray"
                                >{{ $t("webhookIgnoreOwn") }}</span
                            >
                            <span
                                v-if="hook.hasSecret"
                                class="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary"
                                >{{ $t("webhookSigned") }}</span
                            >
                        </div>
                        <div class="truncate text-sm text-gray">
                            {{ hook.url }}
                        </div>
                    </div>
                    <button
                        type="button"
                        @click="removeWebhook(hook.id)"
                        v-tooltip="$t('delete')"
                        class="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-gray transition-colors hover:bg-primary/10 hover:text-primary"
                    >
                        <Trash2 class="size-5" />
                    </button>
                </li>
            </ul>
            <p v-else class="mb-6 text-sm text-gray">
                {{ $t("webhooksEmpty") }}
            </p>

            <form @submit.prevent="addWebhook" class="space-y-4 text-left">
                <div>
                    <label class="mb-1 block text-sm/6 font-medium text-gray">{{
                        $t("board")
                    }}</label>
                    <SelectMenu
                        v-model="boardId"
                        :options="boardOptions"
                        class="w-full"
                    />
                </div>
                <label class="block w-full space-y-1">
                    <span class="block text-sm"
                        >{{ $t("webhookUrl")
                        }}<span class="ml-1 text-primary">*</span></span
                    >
                    <input
                        v-model="url"
                        type="url"
                        required
                        placeholder="https://example.com/hooks/lokalboards"
                        class="form-control"
                        autocomplete="off"
                    />
                </label>
                <InputField
                    type="text"
                    :label="$t('webhookSecret')"
                    v-model="secret"
                />
                <InputCheckbox
                    v-model="ignoreOwnActions"
                    :label="$t('webhookIgnoreOwnLabel')"
                />
                <input
                    type="submit"
                    :disabled="!boardId || !url"
                    class="block w-full cursor-pointer rounded-lg bg-primary px-4 py-2 text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-primary"
                    :value="$t('webhookAdd')"
                />
            </form>
        </ContentBox>
    </div>
</template>
<script setup lang="ts">
import { Trash2, Webhook } from "@lucide/vue";

const nuxtApp = useNuxtApp();

const webhooks = ref([]);
const url = ref("");
const secret = ref("");
const ignoreOwnActions = ref(true);
const boardId = ref(null);

const { data: hookData } = await useFetch("/api/data/webhooks");
if (hookData.value?.webhooks) webhooks.value = hookData.value.webhooks;

// Only boards the user can actually see can be subscribed to.
const { data: session } = await useFetch("/api/auth/get-session");
const { data: boardData } = await useFetch("/api/data/boards", {
    method: "POST",
    body: { userId: session.value?.data?.user?.id },
});
const { data: sharedData } = await useFetch("/api/data/boards", {
    method: "POST",
    body: { userId: session.value?.data?.user?.id, shared: true },
});
const boardOptions = computed(() => {
    const all = [
        ...(boardData.value?.boards || []),
        ...(sharedData.value?.boards || []),
    ];
    return all.map((b) => ({ value: b.id, label: b.name }));
});
if (boardOptions.value.length) boardId.value = boardOptions.value[0].value;

const addWebhook = async () => {
    try {
        const response = await $fetch("/api/data/webhooks", {
            method: "POST",
            body: {
                boardId: boardId.value,
                url: url.value,
                secret: secret.value || undefined,
                ignoreOwnActions: ignoreOwnActions.value,
            },
        });
        if (response.success) {
            webhooks.value.unshift(response.webhook);
            url.value = "";
            secret.value = "";
            await nuxtApp.callHook("app:toast", { message: $t("webhookAdded") });
        } else {
            throw new Error(response.error || "WEBHOOK_FAILED");
        }
    } catch (e) {
        await nuxtApp.callHook("app:toast", {
            message: e?.data?.error || e?.message || $t("error"),
        });
    }
};

const removeWebhook = async (id) => {
    try {
        await $fetch(`/api/data/webhooks?id=${id}`, { method: "DELETE" });
        webhooks.value = webhooks.value.filter((h) => h.id !== id);
        await nuxtApp.callHook("app:toast", { message: $t("webhookDeleted") });
    } catch (e) {
        await nuxtApp.callHook("app:toast", {
            message: e?.data?.error || e?.message || $t("error"),
        });
    }
};
</script>
