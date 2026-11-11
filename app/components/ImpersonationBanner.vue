<template>
    <div
        v-if="isImpersonating"
        class="sticky top-0 z-50 flex w-full items-center justify-center gap-x-3 gap-y-1 bg-primary px-4 py-2 text-center text-sm font-medium text-white flex-wrap"
    >
        <span class="flex items-center gap-2">
            <VenetianMask class="size-4 shrink-0" />
            {{ $t("impersonatingNotice", { name: impersonatedName }) }}
        </span>
        <button
            @click="stop"
            type="button"
            :disabled="stopping"
            class="rounded-full bg-white/20 px-3 py-1 text-white transition-colors hover:bg-white/30 disabled:opacity-60 cursor-pointer"
        >
            {{ $t("stopImpersonating") }}
        </button>
    </div>
</template>
<script setup lang="ts">
import { VenetianMask } from "@lucide/vue";

const nuxtApp = useNuxtApp();
const { data: session } = await useFetch("/api/auth/get-session");

const isImpersonating = computed(
    () => !!session.value?.data?.session?.impersonatedBy,
);
// While impersonating, the resolved user IS the target — so their name labels
// the banner.
const impersonatedName = computed(
    () => session.value?.data?.user?.name || session.value?.data?.user?.email || "",
);

const stopping = ref(false);
const stop = async () => {
    if (stopping.value) return;
    stopping.value = true;
    try {
        const response = await $fetch("/api/auth/admin/stop-impersonate", {
            method: "POST",
        });
        if (response.success) {
            // Hard navigation so the restored admin session cookie is picked up
            // everywhere.
            window.location.href = "/dashboard/";
            return;
        }
        throw new Error(response.error || "STOP_IMPERSONATE_FAILED");
    } catch (e) {
        stopping.value = false;
        await nuxtApp.callHook("app:toast", {
            message: e?.data?.error || e?.message || $t("error"),
        });
    }
};
</script>
