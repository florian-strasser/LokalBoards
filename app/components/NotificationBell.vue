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
            <button
                @click="toggleNotifications"
                class="relative text-gray hover:text-primary-hover cursor-pointer block z-10"
                :aria-label="$t('headerNotifications')"
                v-tooltip="$t('headerNotifications')"
            >
                <Bell class="size-5" />
            </button>
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
            <div class="p-4 border-b dark:border-gray/30">
                <h3 class="text-lg font-semibold">
                    {{ $t("headerNotifications") }}
                </h3>
            </div>
            <div class="max-h-96 overflow-y-auto">
                <NuxtLink
                    v-for="notification in notifications"
                    :key="notification.id"
                    :to="
                        notification.cardId
                            ? `/board/${notification.boardId}?card=${notification.cardId}`
                            : `/board/${notification.boardId}`
                    "
                    class="block w-full border-b p-4 dark:border-gray/30 hover:bg-black/5 dark:hover:bg-white/10"
                    @click="showNotifications = false"
                >
                    <div class="flex items-start gap-3 text-sm text-gray">
                        <!-- Actor avatar, same treatment as the comment section. -->
                        <span
                            class="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-sm text-white"
                        >
                            <img
                                v-if="notification.actorImage"
                                :src="notification.actorImage"
                                :alt="actorLabel(notification)"
                                class="h-full w-full object-cover"
                            />
                            <Bot
                                v-else-if="
                                    notification.actorType === 'artificial'
                                "
                                class="size-4"
                            />
                            <template v-else>{{
                                actorLabel(notification).charAt(0).toUpperCase()
                            }}</template>
                        </span>
                        <!-- Same alignment rule as the card timeline: min-h
                             matches the avatar and the text is centred in it, so
                             one line sits on the avatar's centre while two or
                             more start at the top, level with the avatar. -->
                        <span
                            class="flex min-h-9 min-w-0 grow items-center leading-[18px]"
                        >
                            <span class="min-w-0">
                                <span
                                    class="font-medium text-dark dark:text-white"
                                    >{{ actorLabel(notification) }}</span
                                >
                                {{ translateNotification(notification.message) }}
                                <span
                                    class="whitespace-nowrap text-xs opacity-75"
                                    >{{ formatDate(notification.createdAt) }}</span
                                >
                            </span>
                        </span>
                        <!-- Unread marker. -->
                        <span
                            v-if="!notification.isRead"
                            class="mt-3.5 size-2 shrink-0 rounded-full bg-primary"
                            :aria-label="$t('unread')"
                        />
                    </div>
                    <!-- A comment renders in its own bubble, like on a card,
                         indented past the avatar (size-9 + gap-3). -->
                    <div
                        v-if="notificationBody(notification.message)"
                        class="wysiwyg-wrapper mt-2 ml-12 rounded-lg bg-dark/5 px-3 py-2 text-sm text-dark dark:bg-white/10 dark:text-white"
                        v-html="
                            sanitizeHtml(notificationBody(notification.message))
                        "
                    />
                </NuxtLink>
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
import { Bell, Bot } from "lucide-vue-next";

// Dates render in the instance's timezone and language, identically on the
// server and in the browser — see the composable.
const { formatServerDate } = useServerDate();

const props = defineProps({
    userID: String,
});

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

// The comment body of a comment notification, so the template can render it in
// its own bubble the way the card's comment section does. Empty for other types.
const notificationBody = (message: string): string => {
    if (!message?.startsWith('New comment by "')) return "";
    const m = message.match(/on card "([^"]*)"/);
    const marker = `"${m ? m[1] : ""}":`;
    const i = message.indexOf(marker);
    return i < 0 ? "" : message.substring(i + marker.length).trim();
};

// Who triggered it. Prefer the joined actor (has an avatar); fall back to the
// name embedded in the message for rows created before actorId existed, and to
// a generic label for system notifications like due reminders.
const actorLabel = (n: any): string => {
    if (n.actorName) return n.actorName;
    const m = String(n.message || "").match(
        /New comment by "([^"]+)"|^"([^"]+)" created a new card/,
    );
    return m ? m[1] || m[2] : $t("systemActor");
};

// Explicit 2-digit day/month/hour/minute/second so localized formats keep
// leading zeros (e.g. de-DE "03.07.2026, 02:09:00" instead of "3.7.2026").
const formatDate = (dateString) =>
    formatServerDate(dateString, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });

const translateNotification = (message: string): string => {
    // Every branch returns an actor-led sentence naming the card, because the
    // actor is already the heading of the row — the same phrasing the card's
    // own activity timeline uses.

    // Card "name" moved from "area1" to "area2"
    if (
        message.startsWith('Card "') &&
        message.includes('" moved from "') &&
        message.includes('" to "')
    ) {
        return $t("notifMovedCard", {
            cardName: (message.match(/Card "([^"]*)"/) || [])[1] || "",
            from: (message.match(/from "([^"]*)"/) || [])[1] || "",
            to: (message.match(/to "([^"]*)"/) || [])[1] || "",
        });
    }

    // Card "name" status changed to completed/reopened
    if (
        message.startsWith('Card "') &&
        message.includes('" status changed to ')
    ) {
        const cardName = (message.match(/Card "([^"]*)"/) || [])[1] || "";
        const completed = message.includes("status changed to completed");
        return $t(completed ? "notifCompletedCard" : "notifReopenedCard", {
            cardName,
        });
    }

    // New comment by "username" on card "cardname": the body is rendered
    // separately, in its own bubble (see notificationBody).
    if (message.startsWith('New comment by "')) {
        // `*` not `+`: a card whose name was empty stored `on card ""`, which a
        // `+` pattern skips entirely — that's what rendered as `auf Karte ""`.
        const cardName = (message.match(/on card "([^"]*)"/) || [])[1] || "";
        return $t("notifCommentedOn", {
            cardName: cardName || $t("untitledCard"),
        });
    }

    // "username" created a new card "cardName" on board "boardName"
    if (message.includes(" created a new card ")) {
        return $t("notifCreatedCard", {
            cardName:
                (message.match(/created a new card "([^"]*)"/) || [])[1] || "",
        });
    }

    // Legacy format: New card created: cardName
    if (message.startsWith("New card created:")) {
        return $t("notifCreatedCard", {
            cardName: message.slice("New card created:".length).trim(),
        });
    }

    // Card "cardName" is due on <ISO date> — no human actor, so it reads as a
    // reminder from the app itself.
    if (message.startsWith('Card "') && message.includes('" is due on ')) {
        const dueIso = (message.match(/ is due on (.+)$/) || [])[1] || "";
        return $t("notifCardDue", {
            cardName: (message.match(/Card "([^"]*)"/) || [])[1] || "",
            date: dueIso ? formatDate(dueIso) : "",
        });
    }

    // "username" assigned you the card "cardName"
    if (message.includes(" assigned you the card ")) {
        return $t("notifAssignedCard", {
            cardName:
                (message.match(/assigned you the card "([^"]*)"/) || [])[1] ||
                "",
        });
    }

    // You have been invited to the board <name>
    if (message.startsWith("You have been invited to the board")) {
        return $t("notifInvitedBoard", {
            boardName: message
                .slice("You have been invited to the board".length)
                .replace(/^[:\s]+/, "")
                .trim(),
        });
    }

    // Fallback to the original message if no translation is found
    return message;
};

await refresh(props.userID);
</script>
