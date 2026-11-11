<template>
    <div
        class="flex items-center gap-3 rounded-xl border border-gray/10 bg-light dark:bg-dark/40 px-3 py-3 transition-colors hover:border-primary/40 sm:gap-4 sm:px-4"
    >
        <!-- Avatar: profile image if set, otherwise the first letter of the name. -->
        <span
            class="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-lg font-semibold text-white"
        >
            <img
                v-if="props.image"
                :src="props.image"
                :alt="props.name || ''"
                class="h-full w-full object-cover"
            />
            <template v-else>{{
                (props.name || "?").charAt(0).toUpperCase()
            }}</template>
        </span>

        <div class="min-w-0 grow">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <NuxtLink
                    :to="'/edit-user/' + props.id"
                    class="font-semibold break-words text-dark hover:text-primary-hover dark:text-white"
                    >{{ props.name || "—" }}</NuxtLink
                >
                <span
                    class="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium"
                    :class="
                        props.role === 'admin'
                            ? 'bg-primary/15 text-primary'
                            : 'bg-gray/15 text-gray'
                    "
                >
                    {{ props.role === "admin" ? $t("admin") : $t("user") }}
                </span>
                <span
                    v-if="props.type === 'artificial'"
                    class="flex shrink-0 items-center gap-1 rounded-full bg-gray/15 px-2 py-0.5 text-xs font-medium text-gray"
                    v-tooltip="$t('userTypeArtificial')"
                >
                    <Bot class="size-3.5" />
                    {{ $t("userTypeArtificial") }}
                </span>
                <span
                    v-if="props.isSelf"
                    class="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary"
                >
                    {{ $t("you") }}
                </span>
            </div>
            <div class="truncate text-sm text-gray">{{ props.email }}</div>
        </div>

        <div class="flex shrink-0 items-center gap-1">
            <button
                v-if="!props.isSelf"
                @click="impersonate"
                type="button"
                v-tooltip="$t('impersonate')"
                class="flex size-9 items-center justify-center rounded-lg text-gray transition-colors hover:bg-primary/10 hover:text-primary cursor-pointer"
            >
                <VenetianMask class="size-5" />
            </button>
            <NuxtLink
                :to="'/edit-user/' + props.id"
                v-tooltip="$t('edit')"
                class="flex size-9 items-center justify-center rounded-lg text-gray transition-colors hover:bg-primary/10 hover:text-primary cursor-pointer"
            >
                <SquarePen class="size-5" />
            </NuxtLink>
            <button
                v-if="!props.isSelf"
                @click="openDeleteModal"
                type="button"
                v-tooltip="$t('delete')"
                class="flex size-9 items-center justify-center rounded-lg text-gray transition-colors hover:bg-primary/10 hover:text-primary cursor-pointer"
            >
                <Trash2 class="size-5" />
            </button>
        </div>
    </div>
</template>
<script setup lang="ts">
import { Trash2, SquarePen, VenetianMask, Bot } from "@lucide/vue";

const nuxtApp = useNuxtApp();
const model = defineModel();
const props = defineProps({
    id: String,
    name: String,
    email: String,
    image: String,
    role: String,
    type: String,
    isSelf: Boolean,
});

const openDeleteModal = () => {
    model.value = props.id;
    setBodyScrollLock(true);
};

const impersonate = async () => {
    try {
        const response = await $fetch("/api/auth/admin/impersonate", {
            method: "POST",
            body: { userId: props.id },
        });
        if (response.success) {
            // Hard navigation so the swapped session cookie is picked up by every
            // cached session fetch across the app.
            window.location.href = "/dashboard/";
        } else {
            throw new Error(response.error || "IMPERSONATE_FAILED");
        }
    } catch (e) {
        await nuxtApp.callHook("app:toast", {
            message: e?.data?.error || e?.message || $t("error"),
        });
    }
};
</script>
