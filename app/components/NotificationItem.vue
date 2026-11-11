<template>
    <!-- One notification: who, what, when, an unread dot, and a comment in its
         own bubble. The bell's panel and the dashboard's Activity page draw it
         with this, so the two always look alike. -->
    <NuxtLink
        :to="
            notification.cardId
                ? `/board/${notification.boardId}?card=${notification.cardId}`
                : `/board/${notification.boardId}`
        "
        class="block w-full border-b border-gray/30 p-4 hover:bg-black/5 dark:hover:bg-white/10"
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
</template>

<script setup lang="ts">
import { Bot } from "@lucide/vue";

// Dates render in the instance's timezone and language, identically on the
// server and in the browser — see the composable.
const { formatServerDate } = useServerDate();

defineProps({
    notification: { type: Object, required: true },
});

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
</script>
