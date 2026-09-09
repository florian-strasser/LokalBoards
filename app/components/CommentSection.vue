<template>
    <div v-if="props.writeAccess || timeline.length > 0">
        <h3 class="text-xl font-bold text-dark dark:text-white">
            {{ $t("commentsAndActivity") }}
        </h3>
        <NewCommentForm
            v-if="props.writeAccess"
            :cardID="props.cardID"
            @Comment-created="handleCommentCreated"
        />
        <CommentConnection
            :cardID="props.cardID"
            @comment-created="handleCommentCreated"
            @comment-deleted="handleCommentDeleted"
            @comment-updated="handleCommentUpdated"
        />
        <div v-if="timeline.length > 0" class="mt-4 space-y-4">
            <div v-for="item in timeline" :key="item.key">
                <!-- A card change: one compact line with who and when. -->
                <div
                    v-if="item.kind === 'activity'"
                    class="flex items-start gap-3 px-1 py-1 text-sm text-gray"
                >
                    <span
                        class="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-sm text-white"
                    >
                        <img
                            v-if="item.activity.actorImage"
                            :src="item.activity.actorImage"
                            :alt="item.activity.actorName || ''"
                            class="h-full w-full object-cover"
                        />
                        <Bot
                            v-else-if="item.activity.actorType === 'artificial'"
                            class="size-4"
                        />
                        <template v-else>{{
                            (item.activity.actorName || "?")
                                .charAt(0)
                                .toUpperCase()
                        }}</template>
                    </span>
                    <!-- min-h matches the avatar and the text is centred inside
                         it: a single line therefore sits on the avatar's centre,
                         while two or more lines outgrow the min-height and start
                         at the top, level with the avatar. The inner span keeps
                         the text inline so it still wraps as one flow. -->
                    <span
                        class="flex min-h-9 min-w-0 grow items-center leading-[18px]"
                    >
                        <span class="min-w-0">
                            <span
                                class="font-medium text-dark dark:text-white"
                                >{{
                                    item.activity.actorName || $t("systemActor")
                                }}</span
                            >
                            {{ activityText(item.activity) }}
                            <span class="whitespace-nowrap text-xs opacity-75">{{
                                formatActivityDate(item.activity.createdAt)
                            }}</span>
                        </span>
                    </span>
                </div>
                <!-- A comment: unchanged markup, aliased from the timeline. -->
                <template
                    v-for="comment in item.kind === 'comment'
                        ? [item.comment]
                        : []"
                    :key="comment.id"
                >
                <template v-if="commentToDelete !== comment.id">
                    <template v-if="commentToEdit !== comment.id">
                        <div
                            :id="`comment-${comment.id}`"
                            class="rounded-xl border bg-dark/5 p-4 transition-colors dark:bg-white/5 sm:p-5"
                            :class="
                                highlighted === comment.id
                                    ? 'border-primary'
                                    : 'border-dark/10 dark:border-white/10'
                            "
                        >
                            <CommentContent
                                :content="comment.content"
                                :commentId="comment.id"
                                :cardId="props.cardID"
                                :boardId="getBoardId()"
                                :writeAccess="props.writeAccess"
                                @updated="handleCommentPatched"
                            />
                        </div>
                        <!-- Meta row below the card (not inside it): the comment
                             is the point, so who wrote it and when — plus the
                             owner's edit/delete actions — sit underneath. -->
                        <div class="mt-2 flex items-center gap-3 px-1">
                            <span
                                class="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-sm text-white"
                            >
                                <img
                                    v-if="comment.userImage"
                                    :src="comment.userImage"
                                    class="h-full w-full object-cover"
                                />
                                <template v-else>{{
                                    (comment.userName || "?")
                                        .substring(0, 1)
                                        .toUpperCase()
                                }}</template>
                            </span>
                            <div class="min-w-0 grow">
                                <!-- Wraps rather than truncates: on a narrow
                                     screen the name plus a full timestamp is
                                     wider than the row, and clipping it hid the
                                     date entirely. The name can still ellipsise
                                     on its own if it is very long; the date
                                     stays whole and moves to the next line. -->
                                <p
                                    class="flex flex-wrap items-baseline gap-x-2 text-sm"
                                >
                                    <span
                                        class="max-w-full truncate font-medium text-dark dark:text-white"
                                        >{{ comment.userName }}</span
                                    >
                                    <span
                                        class="whitespace-nowrap text-xs text-gray"
                                        >{{ formatDate(comment.date) }}</span
                                    >
                                </p>
                            </div>
                            <div
                                v-if="comment.user === currentUserId"
                                class="flex shrink-0 items-center gap-1"
                            >
                                <button
                                    type="button"
                                    @click="startEditing(comment)"
                                    v-tooltip="$t('edit')"
                                    class="flex size-8 cursor-pointer items-center justify-center rounded-lg text-gray transition-colors hover:bg-primary/10 hover:text-primary"
                                >
                                    <Pen class="size-4" />
                                </button>
                                <button
                                    type="button"
                                    @click="confirmDelete(comment.id)"
                                    v-tooltip="$t('deleteMessage')"
                                    class="flex size-8 cursor-pointer items-center justify-center rounded-lg text-gray transition-colors hover:bg-primary/10 hover:text-primary"
                                >
                                    <Trash2 class="size-4" />
                                </button>
                            </div>
                        </div>
                    </template>
                    <template v-else>
                        <div
                            class="rounded-xl border border-dark/10 bg-dark/5 p-4 dark:border-white/10 dark:bg-white/5 sm:p-5"
                        >
                            <CardEditor v-model="editingContent" />
                            <div class="mt-3 flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    @click="saveEdit(comment.id)"
                                    class="rounded-lg bg-primary px-4 py-2 text-white hover:bg-primary-hover"
                                >
                                    {{ $t("save") }}
                                </button>
                                <button
                                    type="button"
                                    @click="cancelEdit"
                                    class="rounded-lg bg-primary/10 px-4 text-primary hover:bg-primary-hover hover:text-white dark:bg-white/10 dark:text-white"
                                >
                                    <X class="size-5" />
                                </button>
                            </div>
                        </div>
                    </template>
                </template>
                <template v-else>
                    <div
                        class="rounded-xl border border-dark/10 bg-dark/5 p-4 dark:border-white/10 dark:bg-white/5 sm:p-5"
                    >
                        <p>{{ $t("confirmDeleteComment") }}</p>
                        <div class="mt-3 flex flex-wrap gap-2">
                            <button
                                type="button"
                                class="rounded-lg bg-primary px-4 py-2 text-white hover:bg-primary-hover"
                                @click="executeDelete(comment.id)"
                                v-html="$t('delete')"
                            />
                            <button
                                type="button"
                                @click="cancelDelete"
                                class="rounded-lg bg-primary/10 px-4 text-primary hover:bg-primary-hover hover:text-white dark:bg-white/10 dark:text-white"
                            >
                                <X class="size-5" />
                            </button>
                        </div>
                    </div>
                </template>
                </template>
            </div>
        </div>
        <div v-else class="mt-4">{{ $t("noCommentsYet") }}</div>
    </div>
</template>

<script setup lang="ts">
import { Pen, Trash2, X, Bot } from "lucide-vue-next";
import { socket } from "~/lib/socket";
import type { PropType } from "vue";

// Dates render in the instance's timezone and language, identically on the
// server and in the browser — see the composable.
const { formatServerDate } = useServerDate();

const props = defineProps({
    cardID: Number,
    boardID: Number,
    writeAccess: Boolean,
    currentUserId: String,
    initialComments: {
        type: Array as PropType<Comment[]>,
        default: () => [],
    },
    // Bumped by the card modal after every saved change. The server records the
    // activity entry as part of that save, so the timeline has to re-read it —
    // otherwise ticking a card off only showed up after closing and reopening
    // the card.
    activityVersion: { type: Number, default: 0 },
    // Set when the card was opened from a search hit on one of its comments:
    // that comment is scrolled into view and briefly marked, so you land on the
    // line you searched for instead of somewhere in a long thread.
    highlightCommentId: { type: Number, default: null },
});

const getBoardId = () => {
    return props.boardID;
};

const emits = defineEmits([
    "comment-created",
    "comment-deleted",
    "comment-updated",
    "comment-count-updated",
    "comments-refreshed",
]);

// --- Card activity --------------------------------------------------------
// The card's durable history (status changes, moves, assignments, due dates),
// merged with the comments into one chronological timeline. Stored structured
// on the server and rendered here, so it reads in the viewer's language.
const activity = ref<any[]>([]);

const loadActivity = async () => {
    if (!props.cardID) return;
    try {
        const res: any = await $fetch(
            `/api/data/card-activity?cardId=${props.cardID}`,
        );
        activity.value = res?.activity ?? [];
    } catch (e) {
        console.error("Failed to load card activity:", e);
    }
};
// --- Keeping the list authoritative ---------------------------------------
// The board prefetches every card's comments when it loads, and someone else's
// new comment reaches this browser only as a *count* over the socket — the
// content never travels with it. So by the time the card is opened, the
// prefetched list can be behind the number the tile's badge already promises,
// and only a full page reload used to reconcile them.
//
// Re-fetching when the card opens closes that gap: the prefetch still renders
// instantly and this catches up a moment later. Once the card is open,
// CommentConnection keeps it live from the card's own socket room.
const refreshComments = async () => {
    if (!props.cardID) return;
    try {
        const res: any = await $fetch(
            `/api/data/comment?cardID=${props.cardID}`,
        );
        const fresh: Comment[] = res?.comments ?? [];
        const unchanged =
            fresh.length === comments.value.length &&
            fresh.every(
                (c: any, i: number) =>
                    c.id === (comments.value[i] as any)?.id &&
                    c.content === (comments.value[i] as any)?.content,
            );
        if (unchanged) return;
        comments.value = fresh;
        // Hand it up so the modal and the board replace their prefetched copy:
        // otherwise the badge and the next open would disagree again.
        emits("comments-refreshed", fresh);
    } catch (e) {
        console.error("Failed to refresh comments:", e);
    }
};

// Scroll the linked comment into view once it is on screen, and mark it for a
// few seconds so the eye finds it. Waits for the authoritative list, because
// the comment may not be in the board's prefetched copy at all.
const highlighted = ref<number | null>(null);
let highlightTimer: ReturnType<typeof setTimeout> | undefined;

const revealHighlighted = async () => {
    const id = props.highlightCommentId;
    if (!id) return;
    await nextTick();
    const el = document.getElementById(`comment-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    highlighted.value = id;
    clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => {
        if (highlighted.value === id) highlighted.value = null;
    }, 4000);
};

watch(() => props.highlightCommentId, revealHighlighted);

onMounted(() => {
    refreshComments().then(revealHighlighted);
    loadActivity();
    // Someone else changing this card (status, due date, assignee) writes an
    // activity entry too; the board relays those over the socket.
    socket.on("updateCard", onCardUpdated);
});

onBeforeUnmount(() => {
    socket.off("updateCard", onCardUpdated);
});

const onCardUpdated = ({ card }: any) => {
    if (Number(card?.id) === Number(props.cardID)) loadActivity();
};

// This browser's own changes never come back over the socket (the server
// excludes the sender), so the modal signals them directly.
watch(
    () => props.activityVersion,
    () => loadActivity(),
);

// Newest first, matching how comments are already listed.
const timeline = computed(() => {
    const items = [
        ...comments.value.map((c: any) => ({
            kind: "comment" as const,
            key: `c${c.id}`,
            date: new Date(c.date ?? c.createdAt ?? 0).getTime(),
            seq: Number(c.id) || 0,
            comment: c,
        })),
        ...activity.value.map((a: any) => ({
            kind: "activity" as const,
            key: `a${a.id}`,
            date: new Date(a.createdAt ?? 0).getTime(),
            seq: Number(a.id) || 0,
            activity: a,
        })),
    ];
    // Newest first, matching how comments have always been listed. Timestamps
    // only have second precision, so a burst of changes in the same second
    // needs the id as a tiebreaker — otherwise the sort is a no-op and the
    // batch shows oldest-first, out of step with everything around it.
    return items.sort((x, y) => y.date - x.date || y.seq - x.seq);
});

const activityText = (a: any): string => {
    const d = a.data || {};
    switch (a.type) {
        case "created":
            return $t("activityCreated");
        case "status":
            return d.done ? $t("activityCompleted") : $t("activityReopened");
        case "moved":
            return $t("activityMoved", { from: d.from ?? "?", to: d.to ?? "?" });
        case "assigned":
            return d.assigneeName
                ? $t("activityAssigned", { name: d.assigneeName })
                : $t("activityUnassigned");
        case "due":
            return d.dueDate
                ? $t("activityDueSet", {
                      date: formatServerDate(d.dueDate, {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                      }),
                  })
                : $t("activityDueCleared");
        case "archived":
            return $t("activityArchived");
        case "restored":
            return $t("activityRestored");
        case "labels": {
            const added = (d.added || []).join(", ");
            const removed = (d.removed || []).join(", ");
            // One word out and one word in is a rewording — which is what it
            // is, since rewording a label on a card points that card at a
            // different one. Saying so beats two lines contradicting each
            // other.
            if (d.added?.length === 1 && d.removed?.length === 1)
                return $t("activityLabelsReplaced", {
                    from: removed,
                    to: added,
                });
            if (added && removed)
                return `${$t("activityLabelsAdded", { labels: added })} · ${$t(
                    "activityLabelsRemoved",
                    { labels: removed },
                )}`;
            return added
                ? $t("activityLabelsAdded", { labels: added })
                : $t("activityLabelsRemoved", { labels: removed });
        }
        default:
            return a.type;
    }
};

const formatActivityDate = (value: string) =>
    formatServerDate(value, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });

// Local state for comments to handle additions and deletions
const comments = ref<Comment[]>([...props.initialComments]);

// State for comment deletion confirmation
const commentToDelete = ref<number | null>(null);

const confirmDelete = (commentId: number) => {
    commentToDelete.value = commentId;
};

const cancelDelete = () => {
    commentToDelete.value = null;
};

const executeDelete = async (commentId: number) => {
    await deleteComment(commentId);
    commentToDelete.value = null;
};

// State for comment editing
const commentToEdit = ref<number | null>(null);
const editingContent = ref<string>("");

const startEditing = (comment: Comment) => {
    commentToEdit.value = comment.id;
    editingContent.value = comment.content;
};

const cancelEdit = () => {
    commentToEdit.value = null;
    editingContent.value = "";
};

const saveEdit = async (commentId: number) => {
    try {
        const updatedComment = await $fetch(`/api/data/comment`, {
            method: "PUT",
            body: {
                id: commentId,
                content: editingContent.value,
            },
        });

        if (updatedComment.comment) {
            // Emit socket event for real-time updates
            socket.emit("commentUpdated", {
                cardID: props.cardID,
                comment: updatedComment.comment,
            });

            // Update local state
            const index = comments.value.findIndex((c) => c.id === commentId);
            if (index !== -1) {
                comments.value[index] = updatedComment.comment;
                emits("comment-updated", updatedComment.comment);
            }
        }

        cancelEdit();
    } catch (err) {
        console.error("Error updating comment:", err);
    }
};

// Handle comment updated from socket
const handleCommentUpdated = (updatedComment: Comment) => {
    const index = comments.value.findIndex((c) => c.id === updatedComment.id);
    if (index !== -1) {
        comments.value[index] = updatedComment;
    }
};

// A checklist checkbox was toggled inside a comment (CommentContent PATCHed it).
// Sync local state, broadcast to other users, and bubble it up so the board's
// prefetched card stays fresh on reopen.
const handleCommentPatched = (updatedComment: Comment) => {
    const index = comments.value.findIndex((c) => c.id === updatedComment.id);
    if (index !== -1) {
        comments.value[index] = updatedComment;
    }
    socket.emit("commentUpdated", {
        cardID: props.cardID,
        comment: updatedComment,
    });
    emits("comment-updated", updatedComment);
};

interface Comment {
    id: number;
    card: number;
    user: string;
    userImage: string;
    userName: string;
    content: string;
    date: string;
}

// Handle the creation of a new comment
const handleCommentCreated = (newComment: Comment) => {
    // Check if comment already exists in the array
    if (!comments.value.some((c) => c.id === newComment.id)) {
        comments.value.unshift(newComment);
        emits("comment-created", newComment);
        emits("comment-count-updated", {
            cardId: props.cardID,
            commentCount: comments.value.length,
        });
        socket.emit("commentCountUpdated", {
            cardId: props.cardID,
            commentCount: comments.value.length,
        });
    }
};

const handleCommentDeleted = (deletedCommentId) => {
    comments.value = comments.value.filter((c) => c.id !== deletedCommentId);
    emits("comment-count-updated", {
        cardId: props.cardID,
        commentCount: comments.value.length,
    });
    socket.emit("commentCountUpdated", {
        boardId: props.boardID,
        cardId: props.cardID,
        commentCount: comments.value.length,
    });
};

// Format the date for display. Explicit 2-digit day/month/hour/minute/second so
// localized formats keep leading zeros (e.g. de-DE "08.07.2026, 23:11:02"
// instead of "8.7.2026, 23:11:02").
const formatDate = (dateString: string) =>
    formatServerDate(dateString, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });

// Delete a comment by its creator
const deleteComment = async (commentId: number) => {
    try {
        await $fetch(`/api/data/comment?commentId=${commentId}`, {
            method: "DELETE",
        });
        // Remove from local state
        comments.value = comments.value.filter((c) => c.id !== commentId);
        emits("comment-deleted", commentId);
        // Emit socket events for real-time updates
        socket.emit("commentDeleted", {
            cardID: props.cardID,
            commentId,
        });
    } catch (err) {
        console.error("Error deleting comment:", err);
    }
};

// Listen for real-time comment deletions from other users
socket.on(
    "deleteComment",
    ({ cardID, commentId }: { cardID: number; commentId: number }) => {
        if (cardID === props.cardID) {
            comments.value = comments.value.filter((c) => c.id !== commentId);
        }
    },
);

onBeforeUnmount(() => {
    socket.off("deleteComment");
});
</script>
