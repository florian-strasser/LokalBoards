<template>
    <div v-if="createdKey">
        <h2 class="text-4xl text-dark dark:text-white mb-3">
            {{ $t("createdKeyHeadline") }}
        </h2>
        <div class="relative mb-3">
            <input
                type="text"
                :value="createdKey"
                readonly
                class="form-control !pr-12"
            />
            <div class="absolute top-1 right-1 w-9">
                <button
                    type="button"
                    class="size-9 flex justify-center items-center bg-primary hover:bg-primary-hover rounded-lg text-white"
                    @click="handleCopy"
                    v-tooltip="$t('createdKeyCopyTip')"
                >
                    <Clipboard class="size-5" />
                </button>
            </div>
        </div>
        <p class="text-sm">{{ $t("createdKeyCopyMessage") }}</p>
    </div>
    <form
        v-else
        @submit.prevent="handleNewKey"
        class="relative space-y-4 text-left"
    >
        <InputField
            type="text"
            :label="$t('settingsKeyName')"
            required
            v-model="name"
        />
        <div>
            <label class="block text-sm/6 font-medium text-gray">{{
                $t("settingsKeyExpires")
            }}</label>
            <RadioList
                :values="[
                    { value: 30, label: $t('settingsKeyExpiresIn30Days') },
                    { value: 90, label: $t('settingsKeyExpiresIn90Days') },
                    { value: 180, label: $t('settingsKeyExpiresIn180Days') },
                    { value: 365, label: $t('settingsKeyExpiresIn365Days') },
                ]"
                name="status"
                v-model="expiresIn"
            />
        </div>
        <div>
            <label class="mb-1 block text-sm/6 font-medium text-gray">{{
                $t("settingsKeyAccess")
            }}</label>
            <SegmentedControl
                :values="[
                    { value: 'full', label: $t('settingsKeyAccessFull') },
                    { value: 'read', label: $t('settingsKeyAccessReadonly') },
                ]"
                name="access"
                v-model="access"
            />
            <p class="mt-1 text-xs text-gray">
                {{ $t("settingsKeyAccessHint") }}
            </p>
        </div>
        <input
            type="submit"
            class="block w-full rounded-lg px-4 py-2 bg-primary hover:bg-primary-hover text-white"
            :value="$t('settingsSaveNewKey')"
        />
    </form>
</template>
<script setup lang="ts">
import { Clipboard } from "@lucide/vue";

const nuxtApp = useNuxtApp();

const createdKey = ref(false);
const name = ref("");
const expiresIn = ref(30);
const access = ref("full");

const emits = defineEmits(["key-created"]);

const handleNewKey = async () => {
    try {
        const response = await $fetch("/api/auth/api-key/create", {
            method: "POST",
            body: {
                name: name.value || $t("settingsKeyNameUnknown"),
                expiresIn: 60 * 60 * 24 * expiresIn.value,
                readOnly: access.value === "read",
            },
        });

        if (response.success) {
            console.log(response);
            createdKey.value = response.key;
            emits("key-created", {
                id: response.id,
                name: response.name,
                start: response.start,
                expiresAt: response.expiresAt,
            });
            await nuxtApp.callHook("app:toast", {
                message: $t("savedKey"),
            });
        } else {
            throw new Error(response.error || "Failed to create API key");
        }
    } catch (e) {
        let errorMessage = "Failed to create API key";
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
const handleCopy = async () => {
    try {
        await navigator.clipboard.writeText(createdKey.value);
        await nuxtApp.callHook("app:toast", {
            message: $t("keyCopied"),
        });
    } catch (error) {
        await nuxtApp.callHook("app:toast", {
            message: $t("error_copyFailed"),
        });
    }
};
</script>
