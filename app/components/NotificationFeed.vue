<template>
    <!-- Your notifications on a page of their own: what the bell holds, all of
         it, with room to read. The rows are the bell's own (NotificationItem)
         and so is the list behind them — the same pages, the same unread dots —
         so reading further back here reads further back there too. -->
    <div class="overflow-clip rounded-lg bg-white dark:bg-slate">
        <NotificationItem
            v-for="notification in notifications"
            :key="notification.id"
            :notification="notification"
            class="last:border-b-0"
        />
        <p
            v-if="notifications.length === 0"
            class="p-6 text-center text-sm text-gray"
        >
            {{ $t("noNotifications") }}
        </p>
        <div v-if="hasMore" class="p-3">
            <button
                type="button"
                @click="loadMore"
                :disabled="loadingMore"
                class="w-full rounded-lg px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-60"
            >
                {{ loadingMore ? $t("loadingOlder") : $t("showOlder") }}
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { onResync } from "~/lib/socket";

const props = defineProps({
    userID: { type: String, required: true },
});

const { notifications, hasMore, loadingMore, refresh, loadMore } =
    useNotifications();

// Read afresh when the page is opened rather than shown as the bell last had
// it, and again when a tab that was away comes back.
await refresh(props.userID);

let stopResync = () => {};
onMounted(() => {
    stopResync = onResync(() => refresh(props.userID));
});
onBeforeUnmount(() => stopResync());
</script>
