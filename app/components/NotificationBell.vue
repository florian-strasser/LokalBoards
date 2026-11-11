<template>
    <div>
        <div ref="bellWrapper" class="relative">
            <div
                :class="{ 'opacity-0': unreadCount === 0 }"
                class="absolute top-0 right-0 size-2 transform translate-x-1/2 -translate-y-1/2 rounded-full bg-primary pointer-events-none z-20"
            ></div>
            <div
                :class="{ 'opacity-0': unreadCount === 0 }"
                class="absolute top-0 right-0 size-2 transform translate-x-1/2 -translate-y-1/2 animate-ping rounded-full bg-primary pointer-events-none z-20"
            ></div>
            <!-- A link to Activity, the same notifications on a page of
                 their own, so the bell can be opened in a new tab, bookmarked
                 or copied like any other link. A plain click opens the panel
                 instead, as it always has; see onBellClick. `custom` gives the
                 address without the router's own click handling, which would
                 otherwise leave for the page before the panel could open. -->
            <NuxtLink custom :to="ACTIVITY" v-slot="{ href }">
                <a
                    :href="href"
                    @click="onBellClick"
                    class="relative text-gray hover:text-primary-hover cursor-pointer block z-10"
                    :aria-label="$t('headerNotifications')"
                    :aria-expanded="showNotifications"
                    v-tooltip="$t('headerNotifications')"
                >
                    <Bell class="size-5" />
                </a>
            </NuxtLink>
        </div>
        <!-- Rendered into <body> and positioned in JS against the document's
             client width. `100vw` includes the classic scrollbar, so an
             absolutely-positioned panel anchored to the header pill hung off the
             left edge on narrow screens; measuring instead keeps it on screen
             whatever the scrollbar and container padding do. -->
        <Teleport to="body">
        <div
            v-if="showNotifications"
            ref="panel"
            :style="panelStyle"
            class="fixed bg-white dark:bg-slate rounded-lg overflow-clip shadow-lg z-50"
        >
            <div
                class="flex items-baseline justify-between gap-3 p-4 border-b border-gray/30"
            >
                <h3 class="text-lg font-semibold">
                    {{ $t("headerNotifications") }}
                </h3>
                <!-- All of them on a page of their own, with room to read. -->
                <NuxtLink
                    :to="ACTIVITY"
                    @click="showNotifications = false"
                    class="shrink-0 text-sm font-medium text-primary hover:text-primary-hover"
                    >{{ $t("showAllNotifications") }}</NuxtLink
                >
            </div>
            <div class="max-h-96 overflow-y-auto">
                <NotificationItem
                    v-for="notification in notifications"
                    :key="notification.id"
                    :notification="notification"
                    @click="showNotifications = false"
                />
                <p
                    v-if="notifications.length === 0"
                    class="p-6 text-center text-sm text-gray"
                >
                    {{ $t("noNotifications") }}
                </p>
                <!-- The rest of the history, a page at a time. Sits inside the
                     scrolling list rather than under it, so it is where reading
                     ends up rather than somewhere to scroll back to. -->
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
        </div>
        </Teleport>
    </div>
</template>

<script setup lang="ts">
import { Bell } from "@lucide/vue";

const props = defineProps({
    userID: String,
});

// Activity on the dashboard: these notifications on a page of their own.
const ACTIVITY = "/dashboard/?view=feed";

const showNotifications = ref(false);
// Shared with whoever marks notifications read (opening a card or a board), so
// the unread dot goes out immediately instead of at the next page load.
const { notifications, unreadCount, hasMore, loadingMore, refresh, loadMore } =
    useNotifications();

const bellWrapper = ref(null);
const panel = ref(null);
const panelStyle = ref({});

const PANEL_WIDTH = 384; // w-96
const MARGIN = 16; // keep this much clear of both viewport edges

// Right-align the panel under the bell, then clamp it into the viewport.
// `documentElement.clientWidth` excludes the scrollbar (unlike `100vw`), so the
// panel stays on screen with a classic space-taking scrollbar too.
const positionPanel = () => {
    const anchor = bellWrapper.value;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const available = document.documentElement.clientWidth;
    const width = Math.min(PANEL_WIDTH, available - MARGIN * 2);
    const left = Math.min(
        Math.max(rect.right - width, MARGIN),
        available - width - MARGIN,
    );
    panelStyle.value = {
        top: `${rect.bottom + 12}px`,
        left: `${left}px`,
        width: `${width}px`,
    };
};

// Close when clicking anywhere outside the bell and the panel — the panel now
// floats over the page, so it can't be left hanging there. Outside from the
// start of the press to its end: selecting a notification's text and letting
// go past the panel is reported as a click out there too.
const press = createPressTracker();
const outside = (target: EventTarget | null) =>
    !bellWrapper.value?.contains(target as Node) &&
    !panel.value?.contains(target as Node);
const handleOutsideClick = (event: MouseEvent) => {
    if (press.stayed(event, outside)) showNotifications.value = false;
};

watch(showNotifications, async (open) => {
    if (open) {
        await nextTick();
        positionPanel();
        window.addEventListener("scroll", positionPanel, {
            passive: true,
            capture: true,
        });
        window.addEventListener("resize", positionPanel, { passive: true });
        document.addEventListener("pointerdown", press.down, true);
        document.addEventListener("pointerup", press.up, true);
        document.addEventListener("click", handleOutsideClick);
    } else {
        window.removeEventListener("scroll", positionPanel, true);
        window.removeEventListener("resize", positionPanel);
        document.removeEventListener("pointerdown", press.down, true);
        document.removeEventListener("pointerup", press.up, true);
        document.removeEventListener("click", handleOutsideClick);
    }
});

onBeforeUnmount(() => {
    window.removeEventListener("scroll", positionPanel, true);
    window.removeEventListener("resize", positionPanel);
    document.removeEventListener("pointerdown", press.down, true);
    document.removeEventListener("pointerup", press.up, true);
    document.removeEventListener("click", handleOutsideClick);
});

const toggleNotifications = async () => {
    if (!showNotifications.value) {
        await refresh(props.userID);
    }
    showNotifications.value = !showNotifications.value;
};

// The panel for a plain click. Anything else — another button, or a key held
// for a new tab or window — is left to the browser, which follows the link;
// the context menu never reaches here at all.
const onBellClick = (event: MouseEvent) => {
    if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
    )
        return;
    event.preventDefault();
    toggleNotifications();
};

await refresh(props.userID);
</script>
