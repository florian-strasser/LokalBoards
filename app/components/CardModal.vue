<template>
    <div>
        <div v-if="card" class="card-modal text-left">
            <div v-if="deleteModal" class="w-full">
                <h2 class="text-4xl text-dark dark:text-white text-center mb-4">
                    {{ $t("deleteCardTitle") }}
                </h2>
                <button
                    @click="deleteCard"
                    type="button"
                    class="button bg-primary hover:bg-primary-hover w-full text-center px-6 py-3 rounded-lg text-white cursor-pointer"
                >
                    {{ $t("deleteCardBtn") }}
                </button>
            </div>
            <div v-else-if="moveModal" class="w-full space-y-4">
                <h2 class="text-4xl text-dark dark:text-white text-center mb-4">
                    {{ $t("moveCard") }}
                </h2>

                <label class="block">
                    <span class="text-gray text-sm">{{ $t("moveCardArea") }}</span>
                    <select v-model="moveAreaId" class="form-control mt-1 w-full">
                        <option
                            v-for="area in props.areas"
                            :key="area.id"
                            :value="area.id"
                        >
                            {{ area.name }}
                        </option>
                    </select>
                </label>

                <!-- Nothing to choose between in an empty area: there is one
                     place the card can land, so the question is not asked. -->
                <div v-if="moveTargets.length">
                    <span class="text-gray text-sm">{{
                        $t("moveCardPosition")
                    }}</span>
                    <div class="mt-1 flex flex-wrap gap-2">
                        <button
                            v-for="option in movePlacements"
                            :key="option"
                            type="button"
                            @click="movePlacement = option"
                            class="cursor-pointer rounded-lg px-4 py-2 text-sm transition-colors"
                            :class="
                                movePlacement === option
                                    ? 'bg-primary text-white'
                                    : 'bg-primary/10 text-primary hover:bg-primary/20 dark:bg-white/10 dark:text-white dark:hover:bg-white/20'
                            "
                        >
                            {{ $t(placementLabels[option]) }}
                        </button>
                    </div>
                    <select
                        v-if="movePlacement === 'after'"
                        v-model="moveAfterId"
                        class="form-control mt-2 w-full"
                    >
                        <option
                            v-for="target in moveTargets"
                            :key="target.id"
                            :value="target.id"
                        >
                            {{ target.name }}
                        </option>
                    </select>
                </div>

                <div class="flex gap-2 pt-2">
                    <button
                        type="button"
                        @click="moveModal = false"
                        class="button grow cursor-pointer rounded-lg bg-primary/10 px-6 py-3 text-center text-primary hover:bg-primary/20 dark:bg-white/10 dark:text-white dark:hover:bg-white/20"
                    >
                        {{ $t("cancel") }}
                    </button>
                    <button
                        type="button"
                        @click="submitMove"
                        class="button grow cursor-pointer rounded-lg bg-primary px-6 py-3 text-center text-white hover:bg-primary-hover"
                    >
                        {{ $t("moveCard") }}
                    </button>
                </div>
            </div>
            <div v-else-if="addAttachments" class="w-full">
                <div class="relative space-y-4 text-center">
                    <div
                        @click="fileInput?.click()"
                        @dragover.prevent="handleDragOver"
                        @dragleave.prevent="isDragging = false"
                        @drop.prevent="handleDrop"
                        class="border-2 border-dashed rounded-lg p-8 min-h-48 flex flex-col gap-2 justify-center items-center text-center cursor-pointer transition-colors"
                        :class="
                            isDragging
                                ? 'border-primary bg-primary/10'
                                : 'border-gray/40 hover:border-primary'
                        "
                    >
                        <Upload class="size-8 text-gray shrink-0" />
                        <p class="text-gray">
                            {{ $t("dragAndDropFilesHere") }}
                        </p>
                    </div>
                    <input
                        ref="fileInput"
                        type="file"
                        multiple
                        :accept="attachmentAccept"
                        class="hidden"
                        @change="handleFileSelect"
                    />
                    <button
                        type="button"
                        @click="addAttachments = false"
                        class="hover:text-primary-hover"
                    >
                        {{ $t("back") }}
                    </button>
                </div>
            </div>
            <div v-else>
                <div class="flex gap-3 mb-4">
                    <button
                        type="button"
                        :disabled="!props.writeAccess"
                        class="flex items-center justify-center size-8 rounded-full shrink-0 grow-0"
                        @click="toggleStatus"
                        :class="{
                            'bg-primary border-2 border-primary text-white':
                                currentStatus,
                            'border-2 border-gray hover:border-primary text-white dark:text-slate':
                                !currentStatus && writeAccess,
                            'border-2 border-gray text-white dark:text-slate':
                                !currentStatus && !writeAccess,
                        }"
                    >
                        <Check class="size-4" />
                    </button>
                    <div class="grow shrink">
                        <div
                            ref="cardTitle"
                            contenteditable="plaintext-only"
                            @blur="saveCard"
                            @copy="onTitleCopy"
                            @cut="onTitleCopy"
                            class="editable-underline text-2xl font-bold text-dark dark:text-white w-full focus:outline-none"
                        >
                            {{ name }}
                        </div>
                    </div>
                    <!-- What used to be a bare delete icon. A single
                         irreversible action, one press away, at the top right
                         of a dialog people open to read a card — the same place
                         the board and the dashboard put a menu. It is that menu
                         now, and delete still asks before it acts. -->
                    <div class="grow-0 shrink-0 pt-1.5">
                        <ActionMenu
                            v-if="writeAccess"
                            plain
                            :tooltip="$t('moreOptions')"
                        >
                            <button
                                type="button"
                                @click="openMove"
                                :class="menuItemClass"
                            >
                                <MoveRight class="size-4 shrink-0" />
                                {{ $t("moveCard") }}
                            </button>
                            <button
                                type="button"
                                @click="duplicateCard"
                                :class="menuItemClass"
                            >
                                <CopyPlus class="size-4 shrink-0" />
                                {{ $t("duplicateCard") }}
                            </button>
                            <button
                                type="button"
                                @click="deleteModal = true"
                                :class="menuItemDestructiveClass"
                            >
                                <Trash2 class="size-4 shrink-0" />
                                {{ $t("deleteCardBtn") }}
                            </button>
                        </ActionMenu>
                    </div>
                </div>
                <!-- Card metadata: due date, reminders and assignee live behind
                     Trello-style popovers. When unset a button shows the field
                     name; once set the button shows the value and reopens the
                     menu when clicked. -->
                <div
                    v-if="
                        writeAccess ||
                        dueDate ||
                        assignee ||
                        cardLabels.length
                    "
                    class="mb-4"
                >
                    <div
                        v-if="writeAccess || dueDate || assignee"
                        class="flex flex-wrap items-center gap-2"
                    >
                        <!-- Due date -->
                        <PopoverMenu v-if="writeAccess">
                            <template #trigger>
                                <button type="button" :class="chipClass(!!dueDate)">
                                    <Clock class="size-4 shrink-0" />
                                    <span>{{
                                        dueDate
                                            ? formatDateTime(dueDate)
                                            : $t("dueDate")
                                    }}</span>
                                </button>
                            </template>
                            <template #default>
                                <div class="w-64 space-y-3">
                                    <div>
                                        <label
                                            class="block text-sm font-bold text-dark dark:text-white mb-1"
                                        >
                                            {{ $t("dueDate") }}
                                        </label>
                                        <input
                                            type="datetime-local"
                                            v-model="dueDateInput"
                                            @change="saveCard"
                                            class="form-control"
                                        />
                                    </div>
                                    <div v-if="dueDate">
                                        <label
                                            class="block text-sm font-bold text-dark dark:text-white mb-1"
                                        >
                                            {{ $t("reminders") }}
                                        </label>
                                        <ul
                                            v-if="reminders.length"
                                            class="flex flex-wrap gap-2 mb-2"
                                        >
                                            <li
                                                v-for="m in reminders"
                                                :key="m"
                                                class="flex items-center gap-1 bg-primary/10 dark:bg-white/10 text-dark dark:text-white px-3 py-1 rounded-full text-sm"
                                            >
                                                <Bell class="size-4 shrink-0" />
                                                <span>{{ reminderLabel(m) }}</span>
                                                <button
                                                    type="button"
                                                    @click="removeReminder(m)"
                                                    class="hover:text-primary-hover"
                                                >
                                                    <X class="size-4" />
                                                </button>
                                            </li>
                                        </ul>
                                        <select
                                            v-if="availableReminderPresets.length"
                                            @change="addReminder"
                                            class="form-control text-sm"
                                        >
                                            <option value="">
                                                {{ $t("addReminder") }}
                                            </option>
                                            <option
                                                v-for="preset in availableReminderPresets"
                                                :key="preset.minutes"
                                                :value="preset.minutes"
                                            >
                                                {{ $t(preset.label) }}
                                            </option>
                                        </select>
                                    </div>
                                    <button
                                        v-if="dueDate"
                                        type="button"
                                        @click="clearDueDate"
                                        class="flex items-center gap-1 text-sm text-primary hover:text-primary-hover"
                                    >
                                        <X class="size-4" />
                                        <span>{{ $t("delete") }}</span>
                                    </button>
                                </div>
                            </template>
                        </PopoverMenu>
                        <div v-else-if="dueDate" :class="chipClass(true)">
                            <Clock class="size-4 shrink-0" />
                            <span>{{ formatDateTime(dueDate) }}</span>
                        </div>

                        <!-- Assignee -->
                        <PopoverMenu v-if="writeAccess">
                            <template #trigger>
                                <button
                                    type="button"
                                    :class="chipClass(!!assignee)"
                                >
                                    <span
                                        v-if="assignee && assigneeImage"
                                        class="size-5 rounded-full overflow-hidden shrink-0"
                                    >
                                        <img
                                            :src="assigneeImage"
                                            class="w-full h-full object-cover"
                                        />
                                    </span>
                                    <UserPlus v-else class="size-4 shrink-0" />
                                    <span>{{
                                        assignee ? assigneeName : $t("assignee")
                                    }}</span>
                                </button>
                            </template>
                            <template #default="{ close }">
                                <div class="w-56">
                                    <label
                                        class="block text-sm font-bold text-dark dark:text-white mb-2"
                                    >
                                        {{ $t("assignee") }}
                                    </label>
                                    <ul
                                        class="space-y-1 max-h-60 overflow-auto"
                                    >
                                        <li>
                                            <button
                                                type="button"
                                                @click="setAssignee('', close)"
                                                class="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg hover:bg-primary/10 dark:hover:bg-white/10 text-dark dark:text-white"
                                            >
                                                <span
                                                    class="size-6 rounded-full bg-gray/20 flex items-center justify-center shrink-0"
                                                >
                                                    <X class="size-3.5" />
                                                </span>
                                                <span class="grow text-left">{{
                                                    $t("unassigned")
                                                }}</span>
                                                <Check
                                                    v-if="!assignee"
                                                    class="size-4 text-primary shrink-0"
                                                />
                                            </button>
                                        </li>
                                        <li v-for="m in members" :key="m.id">
                                            <button
                                                type="button"
                                                @click="setAssignee(m.id, close)"
                                                class="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg hover:bg-primary/10 dark:hover:bg-white/10 text-dark dark:text-white"
                                            >
                                                <span
                                                    class="size-6 rounded-full overflow-hidden bg-primary text-white flex items-center justify-center shrink-0 text-xs"
                                                >
                                                    <img
                                                        v-if="m.image"
                                                        :src="m.image"
                                                        class="w-full h-full object-cover"
                                                    />
                                                    <template v-else>{{
                                                        (m.name || "?").charAt(0)
                                                    }}</template>
                                                </span>
                                                <span class="grow text-left">{{
                                                    m.name
                                                }}</span>
                                                <Check
                                                    v-if="assignee === m.id"
                                                    class="size-4 text-primary shrink-0"
                                                />
                                            </button>
                                        </li>
                                    </ul>
                                </div>
                            </template>
                        </PopoverMenu>
                        <div v-else-if="assignee" :class="chipClass(true)">
                            <span
                                v-if="assigneeImage"
                                class="size-5 rounded-full overflow-hidden shrink-0"
                            >
                                <img
                                    :src="assigneeImage"
                                    class="w-full h-full object-cover"
                                />
                            </span>
                            <UserPlus v-else class="size-4 shrink-0" />
                            <span>{{ assigneeName }}</span>
                        </div>
                        <!-- Labels -->
                        <LabelPicker
                            v-model="cardLabels"
                            :boardID="props.boardID"
                            :suggestions="props.boardLabels"
                            :writeAccess="writeAccess"
                            @labels-changed="emits('labels-changed')"
                            @changed="saveCard"
                        />
                    </div>
                    <CardLabels
                        v-model="cardLabels"
                        :boardID="props.boardID"
                        :writeAccess="writeAccess"
                        @labels-changed="emits('labels-changed')"
                        @changed="saveCard"
                    />
                </div>
                <!-- Live presence: who else has this card open right now. On its
                     own line below the metadata buttons so it never competes
                     with them for width. -->
                <div v-if="otherViewers.length" class="mb-4">
                    <PresenceAvatars :users="otherViewers" variant="detailed" />
                </div>

                <div class="mb-4">
                    <template v-if="writeAccess && editingDescription">
                        <CardEditor v-model="content" />
                        <button
                            type="button"
                            class="mt-2 bg-primary hover:bg-primary-hover px-4 py-2 rounded-lg text-white"
                            @click="editingDescription = false"
                        >
                            {{ $t("save") }}
                        </button>
                    </template>
                    <template v-else>
                        <div
                            v-if="content"
                            ref="renderedContent"
                            class="wysiwyg-wrapper"
                            v-html="renderMarkdown(content)"
                            @click="handleDescriptionClick"
                        />
                        <button
                            v-if="writeAccess"
                            type="button"
                            class="mt-4 bg-primary hover:bg-primary-hover px-4 py-2 flex gap-x-1 items-center rounded-lg text-white"
                            @click="editingDescription = true"
                        >
                            <Pencil class="size-5" />
                            <span>{{ $t("editDescription") }}</span>
                        </button>
                    </template>
                </div>

                <!-- Attachments: the add button sits below the list when one
                     exists, otherwise it stands on its own. -->
                <div v-if="attachments.length > 0 || writeAccess" class="mb-4">
                    <div v-if="attachments.length > 0" class="mb-2">
                        <h3
                            class="text-xl font-bold text-dark dark:text-white mb-2"
                        >
                            {{ $t("attachments") }}
                        </h3>
                        <ul class="space-y-2">
                            <li
                                v-for="attachment in attachments"
                                :key="attachment.id"
                                class="flex w-full items-center gap-1 bg-dark/10 dark:bg-white/10 px-3 py-2 rounded-xl"
                            >
                                <!-- Click the name to view images/PDFs in the
                                     modal; other types fall back to download. -->
                                <button
                                    type="button"
                                    @click="openAttachment(attachment)"
                                    class="fade-clip shrink grow min-w-0 px-3 py-2 text-left rounded-lg hover:text-primary-hover"
                                >
                                    {{ attachment.filename }}
                                </button>
                                <button
                                    type="button"
                                    @click="downloadAttachment(attachment)"
                                    v-tooltip="$t('download')"
                                    class="shrink-0 flex size-9 items-center justify-center rounded-lg hover:text-primary-hover"
                                >
                                    <Download class="size-5" />
                                </button>
                                <button
                                    v-if="writeAccess"
                                    type="button"
                                    @click="deleteAttachment(attachment)"
                                    v-tooltip="$t('remove')"
                                    class="shrink-0 flex size-9 items-center justify-center rounded-lg hover:text-primary-hover"
                                >
                                    <Trash2 class="size-5" />
                                </button>
                            </li>
                        </ul>
                    </div>
                    <button
                        v-if="writeAccess"
                        type="button"
                        class="flex gap-x-2 items-center hover:text-primary-hover"
                        @click="addAttachments = true"
                    >
                        <Paperclip class="size-5 shrink-0 grow-0" />
                        <div class="shrink grow">
                            {{ $t("addAttachments") }}
                        </div>
                    </button>
                </div>
                <CommentSection
                    :cardID="props.cardID"
                    :boardID="props.boardID"
                    :writeAccess="props.writeAccess"
                    :currentUserId="props.userID"
                    :initialComments="comments"
                    :activityVersion="activityVersion"
                    :highlightCommentId="props.highlightCommentId"
                    @comment-created="handleCommentCreated"
                    @comment-deleted="handleCommentDeleted"
                    @comment-updated="handleCommentContentUpdated"
                    @comments-refreshed="handleCommentsRefreshed"
                />
                <ImageWindow
                    v-model="imageModalOpen"
                    bare
                    :image-src="selectedImageSrc"
                    :alt="selectedImageAlt || 'Enlarged image'"
                    :source-rect="zoomSourceRect"
                />
            </div>
        </div>
        <div v-else>Loading...</div>
    </div>
</template>
<script setup lang="ts">
import { socket } from "~/lib/socket";
import {
    Check,
    CopyPlus,
    MoveRight,
    Trash2,
    Paperclip,
    Download,
    X,
    Pencil,
    Bell,
    Clock,
    UserPlus,
    Upload,
} from "lucide-vue-next";

// Dates render in the instance's timezone and language, identically on the
// server and in the browser — see the composable.
const { formatServerDate } = useServerDate();
const props = defineProps({
    card: Object,
    cardID: Number,
    boardID: Number,
    writeAccess: Boolean,
    userID: String,
    // The signed-in user, used to announce our presence on the card.
    currentUser: { type: Object, default: () => ({}) },
    // True only when opening a freshly created card for the first time, so the
    // editor is shown immediately instead of the read-only view.
    openInEditMode: Boolean,
    // A comment to scroll to and mark when the card is opened from a search
    // hit on that comment.
    highlightCommentId: { type: Number, default: null },
    // The board's areas and its cards by area, for the move dialog: it needs to
    // offer somewhere to move to, and the cards already there to place against.
    areas: { type: Array, default: () => [] },
    cardsByArea: { type: Object, default: () => ({}) },
    // The words this board is already using, held by the board page. They are
    // only ever offered when a label is added here — what this card wears is
    // this card's own business, and travels with the card.
    boardLabels: { type: Array, default: () => [] },
});

const nuxtApp = useNuxtApp();
const emits = defineEmits([
    "card-updated",
    "card-deleted",
    "card-duplicated",
    "card-moved",
    "comment-count-updated",
    // The board's label set changed from inside the card, so whoever owns that
    // list should re-read it.
    "labels-changed",
]);

// The board's and the dashboard's menu items, to the letter — the menu is the
// same one, so it should not be a different menu here.
const menuItemClass =
    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-dark hover:bg-primary/10 hover:text-primary dark:text-white";
const menuItemDestructiveClass =
    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-dark hover:bg-primary-hover/10 hover:text-primary-hover dark:text-white";

const boxOpen = defineModel();

// The card (incl. comments and attachment metadata) is prefetched on the
// board and passed in as a prop, so the modal renders instantly without an
// extra round trip.
const name = ref(props.card.name);
const content = ref(props.card.content);
const currentStatus = ref(!!props.card.status);

const cardTitle = ref(null);

// Code blocks written with the editor's Codeblock button get a copy button.
const renderedContent = ref<HTMLElement | null>(null);
useCodeCopy(renderedContent, () => ({
    copy: $t("copyCode"),
    copied: $t("codeCopied"),
    failed: $t("error_copyFailed"),
}));
const deleteModal = ref(false);

// --- Moving the card without dragging it --------------------------------
//
// Dragging is fine with a mouse and awkward on a phone, and awkward for
// everybody when the destination is far down a long column.
const moveModal = ref(false);
const moveAreaId = ref<number | null>(null);
const movePlacement = ref<"top" | "bottom" | "after">("bottom");
const moveAfterId = ref<number | null>(null);
const placementLabels = {
    top: "moveCardTop",
    bottom: "moveCardBottom",
    after: "moveCardAfter",
};

const openMove = () => {
    moveAreaId.value = Number(props.card?.area) || null;
    movePlacement.value = "bottom";
    moveAfterId.value = null;
    moveModal.value = true;
};

// What is already in the destination, without the card being moved — the list
// the chosen position is an index into, whichever area it ends up in.
const moveTargets = computed(() => {
    const list = props.cardsByArea?.[moveAreaId.value as any] ?? [];
    return list.filter((card: any) => Number(card.id) !== Number(props.cardID));
});

const movePlacements = ["top", "bottom", "after"] as const;

// "After" needs something to be after: the first card in the destination unless
// one has already been chosen, so the select is never sitting on nothing.
watch(movePlacement, (placement) => {
    if (placement === "after" && moveAfterId.value === null) {
        moveAfterId.value = moveTargets.value[0]?.id ?? null;
    }
});

// Picking another area invalidates a card chosen from the previous one, and an
// empty destination has no position to choose.
watch(moveAreaId, () => {
    moveAfterId.value = moveTargets.value[0]?.id ?? null;
    if (!moveTargets.value.length) movePlacement.value = "bottom";
});

const submitMove = () => {
    const targets = moveTargets.value;
    let newIndex = targets.length;
    if (movePlacement.value === "top") {
        newIndex = 0;
    } else if (movePlacement.value === "after") {
        const at = targets.findIndex(
            (card: any) => Number(card.id) === Number(moveAfterId.value),
        );
        newIndex = at < 0 ? targets.length : at + 1;
    }
    emits("card-moved", {
        cardId: Number(props.cardID),
        fromAreaId: Number(props.card?.area),
        toAreaId: Number(moveAreaId.value),
        newIndex,
    });
    moveModal.value = false;
};
const addAttachments = ref(false);
const isDragging = ref(false); // highlight the drop zone while a file is over it
const fileInput = ref(null); // hidden <input type="file"> for click-to-select
// Write-access users see the read-only description with an "edit description"
// button by default; the editor is only shown right away for a freshly created
// card opened for the first time.
const editingDescription = ref(!!props.openInEditMode);
const attachments = ref([...(props.card.attachments || [])]);
const newAttachments = ref([]);
const comments = ref(props.card.comments || []);
// Bumped after each saved change so the comment/activity timeline re-reads the
// entry the server just recorded.
const activityVersion = ref(0);

// --- Due date, assignee & reminders -------------------------------------
const dueDate = ref(props.card.dueDate || ""); // ISO string, or "" when unset
const assignee = ref(props.card.assignee || "");
const reminders = ref([...(props.card.reminders || [])]);
const members = ref([]); // board members for the assignee picker
// The labels themselves rather than their ids: they are what the tile behind
// this modal draws, so a label added here reaches it without waiting for the
// board to re-read anything.
const cardLabels = ref([...(props.card.labels || [])]);

// Shared chip/button style for the metadata popover triggers. Filled when the
// field holds a value, subtler when it's still an "add" prompt.
const chipClass = (isSet) =>
    "flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg text-dark dark:text-white " +
    (isSet
        ? "bg-primary/10 dark:bg-white/10 hover:bg-primary/20 dark:hover:bg-white/20"
        : "bg-dark/5 dark:bg-white/10 hover:bg-dark/10 dark:hover:bg-white/20");

const REMINDER_PRESETS = [
    { minutes: 0, label: "reminderAtDueTime" },
    { minutes: 5, label: "reminder5min" },
    { minutes: 15, label: "reminder15min" },
    { minutes: 30, label: "reminder30min" },
    { minutes: 60, label: "reminder1hour" },
    { minutes: 1440, label: "reminder1day" },
    { minutes: 10080, label: "reminder1week" },
];

const availableReminderPresets = computed(() =>
    REMINDER_PRESETS.filter((p) => !reminders.value.includes(p.minutes)),
);

const reminderLabel = (minutes) => {
    const preset = REMINDER_PRESETS.find((p) => p.minutes === minutes);
    return preset ? $t(preset.label) : `${minutes} min`;
};

const assigneeName = computed(() => {
    if (!assignee.value) return "";
    const member = members.value.find((m) => m.id === assignee.value);
    return member ? member.name : props.card.assigneeName || "";
});

const assigneeImage = computed(() => {
    if (!assignee.value) return "";
    const member = members.value.find((m) => m.id === assignee.value);
    return member ? member.image : props.card.assigneeImage || "";
});

const setAssignee = (id, close) => {
    assignee.value = id;
    saveCard();
    if (close) close();
};

const pad = (n) => String(n).padStart(2, "0");

// Map the stored ISO due date to/from the `datetime-local` input (local time).
const dueDateInput = computed({
    get() {
        if (!dueDate.value) return "";
        const d = new Date(dueDate.value);
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },
    set(value) {
        dueDate.value = value ? new Date(value).toISOString() : "";
    },
});

const formatDateTime = (iso) =>
    formatServerDate(iso, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });

const clearDueDate = () => {
    dueDate.value = "";
    saveCard();
};

const addReminder = (event) => {
    const raw = event.target.value;
    event.target.value = ""; // reset the picker back to the placeholder
    if (raw === "") return;
    const minutes = Number(raw);
    if (!Number.isFinite(minutes) || reminders.value.includes(minutes)) return;
    reminders.value.push(minutes);
    reminders.value.sort((a, b) => a - b);
    saveCard();
};

const removeReminder = (minutes) => {
    reminders.value = reminders.value.filter((m) => m !== minutes);
    saveCard();
};

// Click-to-enlarge for images in the read-only description, mirroring the
// behaviour of images in comments (CommentContent.vue).
const imageModalOpen = ref(false);
const selectedImageSrc = ref("");
const selectedImageAlt = ref("");
// Screen rect of the clicked image, so the lightbox can zoom from/to it.
const zoomSourceRect = ref(null);
const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
};
// Image attachments open in this lightbox. Base64 ones become a blob URL that
// we revoke when done (PDFs open in a new tab instead — see openAttachment).
let attachmentBlobUrl: string | null = null;
const revokeAttachmentBlob = () => {
    if (attachmentBlobUrl) {
        URL.revokeObjectURL(attachmentBlobUrl);
        attachmentBlobUrl = null;
    }
};

const handleDescriptionClick = (event) => {
    const target = event.target;
    if (target.tagName === "IMG") {
        event.preventDefault();
        zoomSourceRect.value = rectOf(target);
        selectedImageSrc.value = target.getAttribute("src") || "";
        selectedImageAlt.value = target.getAttribute("alt") || "";
        imageModalOpen.value = true;
        return;
    }
    // Let write-access users tick checklist items straight from the read-only
    // view; toggle the matching item in the stored content and persist it.
    if (target.matches?.('input[type="checkbox"]') && props.writeAccess) {
        event.preventDefault();
        const boxes = Array.from(
            event.currentTarget.querySelectorAll('input[type="checkbox"]'),
        );
        toggleChecklistItem(boxes.indexOf(target));
    }
};

// Toggle the Nth checklist checkbox and let the content watcher save it. The
// content is Markdown, so render it to HTML, flip the box, then convert back.
const toggleChecklistItem = (index) => {
    if (index < 0) return;
    const doc = new DOMParser().parseFromString(
        markdownToHtml(content.value),
        "text/html",
    );
    const box = doc.querySelectorAll('input[type="checkbox"]')[index];
    if (!box) return;
    const li = box.closest("li");
    if (box.hasAttribute("checked")) {
        box.removeAttribute("checked");
        li?.setAttribute("data-checked", "false");
    } else {
        box.setAttribute("checked", "checked");
        li?.setAttribute("data-checked", "true");
    }
    content.value = htmlToMarkdown(doc.body.innerHTML);
};

const handleCommentCreated = (newComment) => {
    comments.value.unshift(newComment);
    emits("comment-count-updated", {
        cardId: props.cardID,
        commentCount: comments.value.length,
        comments: comments.value,
    });
    socket.emit("commentCountUpdated", {
        boardId: props.boardID,
        cardId: props.cardID,
        commentCount: comments.value.length,
    });
};

// The comment section re-fetched the list on open and found it had moved on
// (someone else commented after the board prefetched this card). Adopt it and
// pass it up, so the board's cached card and the tile's badge agree with what
// is on screen — and so reopening the card doesn't fall back to the old copy.
const handleCommentsRefreshed = (fresh) => {
    comments.value = fresh;
    emits("comment-count-updated", {
        cardId: props.cardID,
        commentCount: fresh.length,
        comments: fresh,
    });
};

// A comment's content changed (e.g. a checklist item toggled). Keep the local
// list and — via the comment-count-updated channel — the board's prefetched
// card in sync, so reopening the card shows the change.
const handleCommentContentUpdated = (updatedComment) => {
    const index = comments.value.findIndex((c) => c.id === updatedComment.id);
    if (index !== -1) comments.value[index] = updatedComment;
    emits("comment-count-updated", {
        cardId: props.cardID,
        commentCount: comments.value.length,
        comments: comments.value,
    });
};

const handleCommentDeleted = (deletedCommentId) => {
    comments.value = comments.value.filter((c) => c.id !== deletedCommentId);
    emits("comment-count-updated", {
        cardId: props.cardID,
        commentCount: comments.value.length,
        comments: comments.value,
    });
    socket.emit("commentCountUpdated", {
        boardId: props.boardID,
        cardId: props.cardID,
        commentCount: comments.value.length,
    });
};

const toggleStatus = () => {
    currentStatus.value = !currentStatus.value;
    saveCard();
};

// Accepted attachment MIME types — shared by the drop handler and the file
// picker's `accept` filter.
const ATTACHMENT_TYPES = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "text/csv",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "image/jpg",
    "image/jpeg",
    "image/png",
    "application/zip",
];
const attachmentAccept = ATTACHMENT_TYPES.join(",");

// Function to handle drag over event
const handleDragOver = (event) => {
    event.dataTransfer.dropEffect = "copy";
    isDragging.value = true;
};

// Function to upload file to server
const uploadFileToServer = async (file) => {
    try {
        const formData = new FormData();
        formData.append("file", file);

        const response = await $fetch("/api/upload", {
            method: "POST",
            body: formData,
        });

        return response.url;
    } catch (error) {
        console.error("File upload failed:", error);
        // Fallback to base64 for backward compatibility
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const base64Data = e.target.result.split(",")[1];
                resolve(base64Data);
            };
            reader.readAsDataURL(file);
        });
    }
};

// Upload and attach the given files (shared by drag-drop and the file picker).
const processFiles = async (files) => {
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (ATTACHMENT_TYPES.includes(file.type)) {
            const fileData = await uploadFileToServer(file);

            const attachment = {
                filename: file.name,
                filetype: file.type,
                filesize: file.size,
                filedata: fileData,
                isUrl:
                    typeof fileData === "string" &&
                    (fileData.startsWith("http") || fileData.startsWith("/")),
            };

            newAttachments.value.push(attachment);
            await saveCard();
        } else {
            await nuxtApp.callHook("app:toast", {
                message: $t("wrongFileType"),
            });
        }
    }
    addAttachments.value = false;
};

// Function to handle drop event
const handleDrop = async (event) => {
    isDragging.value = false;
    await processFiles(event.dataTransfer.files);
};

// Function to handle click-to-select via the hidden file input
const handleFileSelect = async (event) => {
    // Copy out of the live FileList before resetting the input — clearing
    // `value` empties `event.target.files`, so processing must use the copy.
    const files = Array.from(event.target.files);
    // Reset so selecting the same file again still fires `change`.
    event.target.value = "";
    await processFiles(files);
};

// Download an attachment. The endpoint answers with `Content-Disposition:
// attachment` and the original filename, so the browser saves the file without
// opening or navigating anywhere.
//
// The link is created and clicked synchronously, with nothing awaited first:
// the previous version fetched the file and only then opened a tab, by which
// point the click that started it had expired, so Safari treated the tab as a
// popup and asked for permission before the download would run. Going straight
// to the endpoint also means the file is never pulled through memory as a
// base64 `data:` URL.
const downloadAttachment = (attachment) => {
    const link = document.createElement("a");
    link.href = `/api/data/attachment?id=${attachment.id}&download=1`;
    // Same-origin, so this is honoured as the saved name; the response header
    // says the same thing for the redirected legacy case.
    link.download = attachment.filename || "";
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

// Open an attachment: images in the lightbox modal, PDFs in a new browser tab
// (in-page PDF iframes are unreliable on mobile). Those are the only two kinds
// a browser can display — a spreadsheet, a Word file or a zip can only be
// saved, so everything else downloads rather than opening a tab that would
// immediately turn into a download anyway.
//
// The type is known from the prefetched metadata, so both branches run
// synchronously and neither is mistaken for a popup.
const openAttachment = (attachment) => {
    const type = (attachment.filetype || "").toLowerCase();
    if (type === "application/pdf") {
        window.open(
            `/api/data/attachment?id=${attachment.id}&raw=1`,
            "_blank",
            "noopener",
        );
        return;
    }
    if (type.startsWith("image/")) {
        openImageAttachment(attachment);
        return;
    }
    downloadAttachment(attachment);
};

// Fetch an image attachment and show it in the lightbox.
const openImageAttachment = async (attachment) => {
    try {
        const file = await $fetch(`/api/data/attachment?id=${attachment.id}`);
        revokeAttachmentBlob();
        const data = file.filedata || "";
        let src: string;
        if (data.startsWith("http") || data.startsWith("/")) {
            src = data; // stored as a URL/path
        } else {
            const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
            src = URL.createObjectURL(
                new Blob([bytes], { type: file.filetype }),
            );
            attachmentBlobUrl = src;
        }
        // No on-screen source thumbnail for attachments → scale from centre.
        zoomSourceRect.value = null;
        selectedImageSrc.value = src;
        selectedImageAlt.value = file.filename || "";
        imageModalOpen.value = true;
    } catch (error) {
        console.error("Failed to open attachment:", error);
    }
};

const deleteAttachment = async (attachment) => {
    try {
        await $fetch(`/api/data/attachment?id=${attachment.id}`, {
            method: "DELETE",
        });
        attachments.value = attachments.value.filter(
            (a) => a.id !== attachment.id,
        );
        // Keep the board tile's attachment count (and other viewers) in sync.
        emits("card-updated", {
            id: props.cardID,
            attachmentCount: attachments.value.length,
            attachments: attachments.value.map(({ filedata, ...meta }) => meta),
        });
        socket.emit("cardUpdated", {
            boardId: props.boardID,
            attachments: attachments.value,
            card: {
                id: props.cardID,
                attachmentCount: attachments.value.length,
            },
        });
    } catch (error) {
        console.error("Failed to delete attachment:", error);
    }
};

// Function to save the card data
// The title is a styled contenteditable, so a normal copy/cut puts the heading's
// rendered HTML (font size/weight/colour) on the clipboard — pasting it into an
// email or doc then carries that styling. Write only plain text instead.
const onTitleCopy = (e: ClipboardEvent) => {
    const text = window.getSelection()?.toString() ?? "";
    if (!text) return;
    e.preventDefault();
    e.clipboardData?.setData("text/plain", text);
    if (e.type === "cut") window.getSelection()?.deleteFromDocument();
};

const saveCard = async () => {
    if (cardTitle.value) {
        name.value = cardTitle.value.textContent || name.value;
    }

    // Optimistically update the board immediately (while this modal is still
    // mounted) so a quick close→reopen shows the change even if the request —
    // and its post-save emit — outlives the modal.
    const assigneeMemberNow = members.value.find(
        (m) => m.id === assignee.value,
    );
    emits("card-updated", {
        id: props.cardID,
        name: name.value,
        content: content.value,
        status: currentStatus.value,
        dueDate: dueDate.value || null,
        assignee: assignee.value || null,
        reminders: [...reminders.value],
        labels: cardLabels.value.map(({ id, name }) => ({ id, name })),
        assigneeName: assigneeMemberNow?.name ?? null,
        assigneeImage: assigneeMemberNow?.image ?? null,
    });

    try {
        const response = await $fetch(`/api/data/card`, {
            method: "PUT",
            body: {
                cardID: props.cardID,
                name: name.value,
                content: content.value,
                status: currentStatus.value,
                files: newAttachments.value,
                dueDate: dueDate.value || null,
                assignee: assignee.value || null,
                reminders: reminders.value,
                labelIds: cardLabels.value.map((label) => label.id),
            },
        });
        // Update the attachments list with the new attachments
        if (response.attachments) {
            attachments.value = [...attachments.value, ...response.attachments];
            newAttachments.value = []; // Clear new attachments after saving
        }

        // Include the prefetched comments and attachment metadata so the
        // board keeps a complete card object and the modal can be reopened
        // without a layout shift.
        const assigneeMember = members.value.find(
            (m) => m.id === (response.card.assignee || ""),
        );
        emits("card-updated", {
            ...response.card,
            comments: comments.value,
            attachments: attachments.value.map(
                ({ filedata, ...meta }) => meta,
            ),
            reminders: response.card.reminders ?? reminders.value,
            labels: cardLabels.value.map(({ id, name }) => ({ id, name })),
            assigneeName: assigneeMember?.name ?? null,
            assigneeImage: assigneeMember?.image ?? null,
        });
        socket.emit("cardUpdated", {
            boardId: props.boardID,
            attachments: attachments.value,
            card: response.card,
        });
        activityVersion.value += 1;
    } catch (err) {
        console.error("Failed to save card:", err);
    }
};

// A second card with the same title, description, checklist, due date,
// reminders, assignee and attachments — and none of the comments, which are a
// conversation about one card rather than part of what the card is.
//
// The dialog closes on success: the copy is a different card, and leaving this
// one open over a board that now has two would say nothing about which is
// which. The board puts the new one directly under the original.
const duplicating = ref(false);

const duplicateCard = async () => {
    if (duplicating.value) return;
    duplicating.value = true;
    try {
        const data = await $fetch("/api/data/card-duplicate", {
            method: "POST",
            body: { cardID: props.cardID },
        });

        if (data.error) {
            await nuxtApp.callHook("app:toast", { message: data.error });
            return;
        }

        emits("card-duplicated", { card: data.card, after: props.card });
        socket.emit("cardCreated", {
            boardId: props.boardID,
            card: data.card,
        });
        await nuxtApp.callHook("app:toast", {
            message: $t("cardDuplicated"),
        });
        boxOpen.value = false;
        setBodyScrollLock(false);
    } catch (err) {
        console.error("Failed to duplicate card:", err);
        await nuxtApp.callHook("app:toast", {
            message: $t("cardDuplicateFailed"),
        });
    } finally {
        duplicating.value = false;
    }
};

const deleteCard = async () => {
    try {
        const response = await $fetch(`/api/data/card`, {
            method: "DELETE",
            body: {
                cardID: props.cardID,
                name: name.value,
                content: content.value,
                status: currentStatus.value,
            },
        });

        await nuxtApp.callHook("app:toast", {
            message: $t("cardDeleted"),
        });
        boxOpen.value = false;
        setBodyScrollLock(false);
        emits("card-deleted", props.card);
        socket.emit("cardDeleted", {
            boardId: props.boardID,
            card: props.card,
        });
    } catch (err) {
        console.error("Failed to deleted card:", err);
    }
};

// Handle card updates from other users
const handleCardUpdated = (updatedCard, updatedAttachments) => {
    if (updatedCard.id === props.cardID) {
        name.value = updatedCard.name;
        content.value = updatedCard.content;
        currentStatus.value = updatedCard.status;
        if (updatedCard.dueDate !== undefined)
            dueDate.value = updatedCard.dueDate || "";
        if (updatedCard.assignee !== undefined)
            assignee.value = updatedCard.assignee || "";
        if (Array.isArray(updatedCard.reminders))
            reminders.value = [...updatedCard.reminders];
        if (Array.isArray(updatedCard.labels))
            cardLabels.value = [...updatedCard.labels];
        // Update attachments if they exist in the updated card
        if (updatedAttachments) {
            attachments.value = updatedAttachments;
        }
    }
};

// Load the board members for the assignee picker.
onMounted(async () => {
    if (!props.writeAccess) return;
    try {
        const data = await $fetch(
            `/api/data/members?boardId=${props.boardID}`,
        );
        if (data?.members) members.value = data.members;
    } catch (err) {
        console.error("Failed to load board members:", err);
    }
});

// Set up socket event listener for card updates (from other users). Keep a
// stable reference so it can actually be removed on unmount.
const onSocketUpdateCard = ({ card, attachments, boardId }) => {
    if (props.boardID === boardId && card.id === props.cardID) {
        handleCardUpdated(card, attachments);
    }
};
// --- Live presence -------------------------------------------------------
// Who else currently has this card open. The server tracks membership of the
// card's socket room; we send our identity on join and drop out on close.
const viewers = ref([]);
const otherViewers = computed(() =>
    viewers.value.filter((v) => v.id !== props.userID),
);

const onCardPresence = ({ cardID, users }) => {
    if (Number(cardID) === Number(props.cardID)) viewers.value = users || [];
};

// Announce ourselves to the card room. The identity comes from the page (which
// already resolved the session) rather than a fetch of our own: a fetch here
// races the mount, and when the modal is deep-linked via ?card= it loses that
// race, leaving the viewer invisible to everyone else.
const joinCardRoom = () => {
    const me = props.currentUser;
    socket.emit("joinCard", {
        cardID: props.cardID,
        boardID: props.boardID,
        user: me?.id
            ? {
                  id: me.id,
                  name: me.name,
                  image: me.image,
                  type: me.type || "human",
              }
            : undefined,
    });
};

onMounted(() => {
    socket.on("cardPresence", onCardPresence);
    // A reconnect gives us a new socket id, so the server no longer knows we
    // are here — re-announce instead of silently vanishing from the card.
    socket.on("connect", joinCardRoom);
    joinCardRoom();
});

onBeforeUnmount(() => {
    socket.off("cardPresence", onCardPresence);
    socket.off("connect", joinCardRoom);
    socket.emit("leaveCard", { cardID: props.cardID });
});

onMounted(() => {
    socket.on("updateCard", onSocketUpdateCard);
});

onBeforeUnmount(() => {
    socket.off("updateCard", onSocketUpdateCard);
    revokeAttachmentBlob();
});

// Watch for changes in name, content, or currentStatus
watch(
    [content],
    () => {
        saveCard();
    },
    { deep: true },
);
</script>
