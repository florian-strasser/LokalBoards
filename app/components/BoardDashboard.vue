<template>
    <div>
        <!-- Ungrouped boards: shown first, no header. New and newly-shared
             boards land here until the user files them. -->
        <div
            ref="ungroupedGrid"
            data-group-id=""
            class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-8"
        >
            <BoardTile
                v-for="board in ungrouped"
                :key="board.id"
                :id="board.id"
                :name="board.name"
                :image="board.image"
                :color="board.color"
                :owned="board.owned"
                :members="board.members"
                :member-count="board.memberCount"
                :unread-count="board.unreadCount"
                show-menu
                @settings="openSettings"
                @invite="openInvite"
                @duplicate="askDuplicateBoard"
                @delete="askDeleteBoard"
                @leave="askLeaveBoard"
            />
            <!-- The same rule the groups follow: only while there is nothing
                 here. With boards in it the tile is one more cell, and a full
                 row plus a tile is a second row holding nothing else. The blue
                 "+" in the page header makes a board at any time. -->
            <button
                v-if="tilesInGroup(null) === 0"
                type="button"
                :class="newBoardTileClass"
                :aria-label="$t('createNewBoard')"
                @click="$emit('new-board', { groupId: null, sort: 0 })"
            >
                <Plus class="size-10" />
            </button>
        </div>

        <!-- The user's groups. Each is its own drop target; boards can be dragged
             within a group, between groups, or to/from the ungrouped area. -->
        <div ref="groupsWrapper" class="mt-4">
            <section
                v-for="group in groups"
                :key="group.id"
                :data-group-section="group.id"
                class="mt-8"
            >
                <div class="mb-4 flex items-center gap-2">
                    <button
                        type="button"
                        class="group-drag-handle flex size-7 shrink-0 items-center justify-center rounded-md text-gray hover:text-dark dark:hover:text-white cursor-grab active:cursor-grabbing"
                        :aria-label="$t('dragToArrange')"
                    >
                        <GripVertical class="size-5" />
                    </button>
                    <button
                        type="button"
                        class="flex size-7 shrink-0 items-center justify-center rounded-md text-gray hover:text-dark dark:hover:text-white"
                        :aria-label="$t('collapse')"
                        @click="toggleCollapse(group)"
                    >
                        <ChevronDown
                            class="size-5 transition-transform"
                            :class="{ '-rotate-90': group.collapsed }"
                        />
                    </button>
                    <input
                        v-model="group.name"
                        class="min-w-0 grow bg-transparent text-2xl font-bold text-dark dark:text-white focus:outline-none"
                        @change="renameGroup(group)"
                        @keydown.enter="($event.target as HTMLInputElement).blur()"
                    />
                    <span class="shrink-0 text-sm text-gray">{{
                        tilesInGroup(group.id)
                    }}</span>
                    <button
                        type="button"
                        class="flex size-7 shrink-0 items-center justify-center rounded-md text-gray hover:text-primary"
                        :aria-label="$t('deleteGroup')"
                        @click="askDeleteGroup(group)"
                    >
                        <Trash2 class="size-5" />
                    </button>
                </div>
                <div
                    v-show="!group.collapsed"
                    :ref="(el) => registerGroupGrid(group.id, el)"
                    :data-group-id="group.id"
                    class="grid min-h-24 grid-cols-1 gap-8 rounded-lg sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4"
                >
                    <BoardTile
                        v-for="board in boardsInGroup(group.id)"
                        :key="board.id"
                        :id="board.id"
                        :name="board.name"
                        :image="board.image"
                        :color="board.color"
                        :owned="board.owned"
                        :members="board.members"
                        :member-count="board.memberCount"
                        :unread-count="board.unreadCount"
                        show-menu
                        @settings="openSettings"
                        @invite="openInvite"
                        @duplicate="askDuplicateBoard"
                        @delete="askDeleteBoard"
                        @leave="askLeaveBoard"
                    />
                    <!-- Only while the group is empty. A group that has to be
                         filled by dragging alone is a poor way to find out that
                         a group is a place boards can be made, so an empty one
                         says so — but once there are boards in it the tile is
                         one more cell in the grid, and a full row of four plus
                         a tile is a second row holding nothing else. The blue
                         "+" in the page header makes a board at any time, and
                         so does the tile above the groups.

                         Creating from here files the board into this group.

                         It is also the whole of the empty state now. There used
                         to be a dashed box captioned "drag boards here", from
                         when dragging was the only way to fill a group; beside a
                         tile that makes one, it was two answers to the same
                         question and a lot of furniture for an empty group. The
                         grid is still the drop target either way. -->
                    <button
                        v-if="tilesInGroup(group.id) === 0"
                        type="button"
                        :class="newBoardTileClass"
                        :aria-label="$t('createNewBoard')"
                        @click="
                            $emit('new-board', {
                                groupId: group.id,
                                sort: tilesInGroup(group.id),
                            })
                        "
                    >
                        <Plus class="size-10" />
                    </button>
                </div>
            </section>
        </div>

        <!-- Add a new group. -->
        <button
            type="button"
            class="mt-8 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10"
            @click="createGroup"
        >
            <FolderPlus class="size-5" />
            {{ $t("newGroup") }}
        </button>

        <!-- The board dialogs, one set for the whole dashboard rather than one
             per tile: a tile is a summary, and forty of them should not each be
             carrying a settings form. `activeBoard` says which board they are
             about. -->
        <ModalWindow v-if="activeBoard" v-model="settingsModal">
            <BoardSettingsForm
                :board="activeBoard"
                :userID="userID"
                @saved="onBoardSaved"
            />
        </ModalWindow>
        <ModalWindow v-if="activeBoard" v-model="inviteModal">
            <InviteModal
                :boardID="String(activeBoard.id)"
                :invitations="invitations"
                @invitations-changed="onInvitationsChanged"
            />
        </ModalWindow>
        <DuplicateBoardModal
            v-if="activeBoard"
            v-model="duplicateBoardModal"
            :boardID="activeBoard.id"
            :sourceName="activeBoard.name"
            @duplicated="onDuplicated"
        />
        <ModalWindow v-model="deleteBoardModal">
            <h2 class="text-4xl text-dark dark:text-white mb-3">
                {{ $t("deleteBoardTitle") }}
            </h2>
            <p class="mb-6">{{ $t("deleteBoardText") }}</p>
            <button
                type="button"
                class="button bg-primary hover:bg-primary-hover w-full rounded-lg px-6 py-3 text-center text-white"
                @click="confirmDeleteBoard"
            >
                {{ $t("deleteBoardBtn") }}
            </button>
        </ModalWindow>
        <ModalWindow v-model="leaveBoardModal">
            <h2 class="text-4xl text-dark dark:text-white mb-3">
                {{ $t("leaveBoardTitle") }}
            </h2>
            <p class="mb-6">{{ $t("leaveBoardText") }}</p>
            <button
                type="button"
                class="button bg-primary hover:bg-primary-hover w-full rounded-lg px-6 py-3 text-center text-white"
                @click="confirmLeaveBoard"
            >
                {{ $t("leaveBoardBtn") }}
            </button>
        </ModalWindow>

        <ModalWindow v-model="deleteGroupModal">
            <h2 class="text-4xl text-dark dark:text-white mb-3">
                {{ $t("deleteGroupTitle") }}
            </h2>
            <p class="mb-6">{{ $t("deleteGroupText") }}</p>
            <button
                type="button"
                class="button bg-primary hover:bg-primary-hover w-full rounded-lg px-6 py-3 text-center text-white"
                @click="confirmDeleteGroup"
            >
                {{ $t("deleteGroupBtn") }}
            </button>
        </ModalWindow>
    </div>
</template>
<script setup lang="ts">
import Sortable from "sortablejs";
import {
    Plus,
    GripVertical,
    ChevronDown,
    Trash2,
    FolderPlus,
} from "lucide-vue-next";

const nuxtApp = useNuxtApp();

// --- data -----------------------------------------------------------------
const { data, error } = await useFetch("/api/data/dashboard");
if (error.value) {
    throw createError({
        status: 500,
        statusText: "Can't connect to the database",
    });
}

// The authoritative model. SortableJS reorders the DOM on drop; we then read the
// DOM back into these refs so Vue and the server agree on one arrangement.
const boards = ref<any[]>((data.value?.boards ?? []).map((b: any) => ({ ...b })));
const groups = ref<any[]>((data.value?.groups ?? []).map((g: any) => ({ ...g })));

// Boards with no placement yet sort after placed ones, newest first (the fetch
// already returns id-desc), so a freshly created/shared board shows up on top.
const sortBoards = (list: any[]) =>
    [...list].sort((a, b) => {
        const sa = a.placementSort,
            sb = b.placementSort;
        if (sa == null && sb == null) return 0; // keep fetch order (id desc)
        if (sa == null) return -1;
        if (sb == null) return 1;
        return sa - sb;
    });

const ungrouped = computed(() =>
    sortBoards(boards.value.filter((b) => b.groupId == null)),
);
const boardsInGroup = (gid: number) =>
    sortBoards(boards.value.filter((b) => b.groupId === gid));

// --- persistence ----------------------------------------------------------
// After any board drag, rebuild the model from the DOM (the single source of
// truth once SortableJS has moved things) and persist the whole arrangement.
const ungroupedGrid = ref<HTMLElement | null>(null);
const groupGrids = new Map<number, HTMLElement>();
const registerGroupGrid = (gid: number, el: any) => {
    if (el) groupGrids.set(gid, el);
    else groupGrids.delete(gid);
};

// --- what is in a group right now ------------------------------------------
// SortableJS moves the DOM as you drag and only tells us at the drop, so the
// model is a drag behind: a board dragged into an empty group sat next to that
// group's "new board" tile instead of taking its place, and a group whose last
// board was dragged out kept an empty grid until the mouse came up.
//
// While a drag is running the tiles are counted from the DOM, which is where
// the truth is at that moment. The rest of the time the model answers.
const dragging = ref(false);
const liveCounts = ref<Record<string, number>>({});

// `.sortable-fallback` is the clone that follows the cursor, and SortableJS
// parks it in the list the drag started from — so a group that had just been
// emptied still counted one tile, and its "new board" tile stayed away until
// the mouse came up. The placeholder in the target list (`.sortable-ghost`) is
// deliberately counted: it is where the board is about to land.
// The ungrouped area has no group id; it is keyed by the empty string, which is
// also what its grid carries in `data-group-id`.
const UNGROUPED = "";

const countTiles = () => {
    const counts: Record<string, number> = {};
    const tiles = (grid: HTMLElement) =>
        grid.querySelectorAll("[data-board-id]:not(.sortable-fallback)").length;
    if (ungroupedGrid.value) counts[UNGROUPED] = tiles(ungroupedGrid.value);
    for (const [gid, grid] of groupGrids) counts[String(gid)] = tiles(grid);
    liveCounts.value = counts;
};

// How many boards a section holds. `null` is the ungrouped area above the
// groups, which follows the same rules as the rest of them.
const tilesInGroup = (gid: number | null) => {
    const key = gid === null ? UNGROUPED : String(gid);
    if (dragging.value) {
        const live = liveCounts.value[key];
        if (live !== undefined) return live;
    }
    return gid === null ? ungrouped.value.length : boardsInGroup(gid).length;
};

const readArrangementFromDom = () => {
    const placements: { boardId: number; groupId: number | null; sort: number }[] =
        [];
    const apply = (grid: HTMLElement | null, groupId: number | null) => {
        if (!grid) return;
        const tiles = grid.querySelectorAll("[data-board-id]");
        tiles.forEach((el, i) => {
            const boardId = Number((el as HTMLElement).dataset.boardId);
            if (boardId) placements.push({ boardId, groupId, sort: i });
        });
    };
    apply(ungroupedGrid.value, null);
    for (const [gid, grid] of groupGrids) apply(grid, gid);
    return placements;
};

const persistArrangement = async () => {
    const placements = readArrangementFromDom();
    // Update the local model so computed lists match the new DOM order.
    const byId = new Map(placements.map((p) => [p.boardId, p]));
    for (const b of boards.value) {
        const p = byId.get(b.id);
        if (p) {
            b.groupId = p.groupId;
            b.placementSort = p.sort;
        }
    }
    try {
        await $fetch("/api/data/board-arrangement", {
            method: "POST",
            body: { placements },
        });
    } catch (e) {
        console.error("Failed to save arrangement:", e);
    }
};

// --- SortableJS wiring -----------------------------------------------------
let sortables: any[] = [];
const destroySortables = () => {
    sortables.forEach((s) => s.destroy());
    sortables = [];
};

const wireBoardGrids = () => {
    const grids: HTMLElement[] = [];
    if (ungroupedGrid.value) grids.push(ungroupedGrid.value);
    for (const el of groupGrids.values()) grids.push(el);
    for (const grid of grids) {
        sortables.push(
            Sortable.create(grid, {
                group: "dashboard-boards",
                // A touch that starts on a card should be allowed to
                // become a scroll. Without a delay SortableJS claims the
                // gesture the moment a finger lands, so swiping the board
                // on a phone picked a card up instead of scrolling. Holding
                // still for a moment starts a drag; moving before that
                // scrolls, and the threshold is what tells the two apart.
                // Mouse drags are unaffected — the delay is touch-only.
                delay: 250,
                delayOnTouchOnly: true,
                touchStartThreshold: 5,
                // The tile itself, the way a card on a board is the thing you
                // pick up. It used to take a grip in the corner, which is one
                // more thing to find and nothing the rest of the app asks for.
                draggable: "[data-board-id]", // never the "new board" button
                // …except its menu. Without this, pressing the three dots and
                // moving a pixel starts dragging the board instead of opening
                // the menu. `preventOnFilter: false` leaves the button's own
                // click alone, which is the whole point of excluding it.
                filter: "button[aria-haspopup='menu']",
                preventOnFilter: false,
                animation: 150,
                forceFallback: true,
                onStart: () => {
                    dragging.value = true;
                    countTiles();
                },
                // Fires whenever the dragged board changes place, in this list
                // or another — which is exactly when a group may have just
                // gained its first tile or lost its last.
                onChange: () => countTiles(),
                onAdd: () => countTiles(),
                onRemove: () => countTiles(),
                onEnd: () => {
                    persistArrangement();
                    dragging.value = false;
                },
            }),
        );
    }
};

const wireGroupReorder = () => {
    if (!groupsWrapper.value) return;
    sortables.push(
        Sortable.create(groupsWrapper.value, {
            handle: ".group-drag-handle",
            draggable: "[data-group-section]",
            animation: 150,
            forceFallback: true,
            onEnd: async () => {
                const order = Array.from(
                    groupsWrapper.value!.querySelectorAll("[data-group-section]"),
                ).map((el) => Number((el as HTMLElement).dataset.groupSection));
                // Reorder the local model to match.
                groups.value.sort(
                    (a, b) => order.indexOf(a.id) - order.indexOf(b.id),
                );
                try {
                    await $fetch("/api/data/board-arrangement", {
                        method: "POST",
                        body: { groupOrder: order },
                    });
                } catch (e) {
                    console.error("Failed to save group order:", e);
                }
            },
        }),
    );
};

const groupsWrapper = ref<HTMLElement | null>(null);

// Re-wire whenever the set of grids changes (a group added/removed), on the next
// tick so refs for new grids exist.
const rewire = () =>
    nextTick(() => {
        destroySortables();
        wireBoardGrids();
        wireGroupReorder();
    });

onMounted(rewire);
onBeforeUnmount(destroySortables);

// --- group CRUD -----------------------------------------------------------
const createGroup = async () => {
    try {
        const res: any = await $fetch("/api/data/board-groups", {
            method: "POST",
            body: { name: $t("newGroupName") },
        });
        if (res?.group) {
            groups.value.push({ ...res.group });
            rewire();
        }
    } catch (e) {
        console.error("Failed to create group:", e);
    }
};

const renameGroup = async (group: any) => {
    const name = (group.name || "").trim();
    if (!name) {
        group.name = $t("newGroupName");
    }
    try {
        await $fetch("/api/data/board-groups", {
            method: "PATCH",
            body: { id: group.id, name: group.name.trim() },
        });
    } catch (e) {
        console.error("Failed to rename group:", e);
    }
};

const toggleCollapse = async (group: any) => {
    group.collapsed = !group.collapsed;
    try {
        await $fetch("/api/data/board-groups", {
            method: "PATCH",
            body: { id: group.id, collapsed: group.collapsed },
        });
    } catch (e) {
        console.error("Failed to toggle group:", e);
    }
    // A collapsed grid is v-show'd away; re-wire so Sortable tracks the DOM.
    rewire();
};

const deleteGroupModal = ref(false);
const groupToDelete = ref<any>(null);
const askDeleteGroup = (group: any) => {
    groupToDelete.value = group;
    deleteGroupModal.value = true;
    setBodyScrollLock(true);
};
const confirmDeleteGroup = async () => {
    const group = groupToDelete.value;
    deleteGroupModal.value = false;
    setBodyScrollLock(false);
    if (!group) return;
    try {
        await $fetch("/api/data/board-groups", {
            method: "DELETE",
            body: { id: group.id },
        });
        // Its boards fall back to ungrouped locally too.
        for (const b of boards.value) if (b.groupId === group.id) b.groupId = null;
        groups.value = groups.value.filter((g) => g.id !== group.id);
        rewire();
    } catch (e) {
        console.error("Failed to delete group:", e);
    }
};

// --- the board dialogs -----------------------------------------------------
// Settings, invite, delete and leave, opened from a tile's menu. The board page
// offers the same four; this is the same work without opening the board first.
import { socket } from "~/lib/socket";

const { data: session } = await useFetch("/api/auth/get-session");
const userID = session.value?.data?.user?.id ?? "";

const activeBoardId = ref<number | null>(null);
const activeBoard = computed(
    () => boards.value.find((b) => b.id === activeBoardId.value) ?? null,
);
const settingsModal = ref(false);
const inviteModal = ref(false);
const deleteBoardModal = ref(false);
const duplicateBoardModal = ref(false);
const leaveBoardModal = ref(false);
const invitations = ref<any[]>([]);

// These dialogs sit behind `v-if="activeBoard"`, so the first use of a tile's
// menu creates one and opens it in the same tick — and a dialog that is already
// open when it is created shows itself without animating. (That unanimated path
// is deliberate, for a card opened straight from a URL: there is nothing to
// animate from when the page arrives with the dialog already showing.) Naming
// the board first and opening on the next tick gives it a closed state to
// animate out of. Only the first one ever looked wrong, because `activeBoard`
// stays set afterwards and the dialogs are already there for the second.
const openForBoard = async (id: number, flag: { value: boolean }) => {
    activeBoardId.value = id;
    await nextTick();
    flag.value = true;
};

const openSettings = (id: number) => openForBoard(id, settingsModal);

// The invite dialog is given the board's current invitations, the same list the
// board page hands it, so it opens showing who is already on the board. They are
// fetched before it is named, so the dialog is created with them already in hand
// rather than filling in after it is on screen.
const openInvite = async (id: number) => {
    invitations.value = [];
    try {
        const data: any = await $fetch(
            `/api/data/invite?boardId=${id}&userId=${userID}`,
        );
        invitations.value = data?.invitations ?? [];
    } catch (err) {
        console.error("Could not load the board's members:", err);
    }
    await openForBoard(id, inviteModal);
};

const askDuplicateBoard = (id: number) =>
    openForBoard(id, duplicateBoardModal);

// The copy is the caller's own board, and the point of making it is to start
// filling it in — so it opens.
const onDuplicated = (board: any) => navigateTo(`/board/${board.id}`);

const askDeleteBoard = (id: number) => openForBoard(id, deleteBoardModal);

const askLeaveBoard = (id: number) => openForBoard(id, leaveBoardModal);

// A board's own row, updated in place. The tile re-renders from it, so a rename
// or a new colour shows without a round trip.
const patchBoard = (id: number, patch: Record<string, any>) => {
    const board = boards.value.find((b) => b.id === id);
    if (board) Object.assign(board, patch);
};

const onBoardSaved = async (board: any) => {
    patchBoard(board.id, {
        name: board.name,
        style: board.style,
        status: board.status,
        image: board.image,
        color: board.color,
    });
    settingsModal.value = false;
    // Everyone else: the people looking at the board itself, and the people
    // looking at a dashboard with a tile for it.
    socket.emit("boardUpdated", {
        boardID: board.id,
        boardName: board.name,
        boardStyle: board.style,
        boardStatus: board.status,
        boardImage: board.image,
        boardColor: board.color,
    });
    await nuxtApp.callHook("app:toast", { message: $t("boardSaved") });
};

// Who is on the board decides what the tile's avatar stack shows, and that is a
// server-side count and cut of four, so the dashboard is refetched rather than
// patched by hand from a list of invitations. Everyone else is told by the
// invite endpoint itself.
const onInvitationsChanged = async () => {
    await reload();
};

const confirmDeleteBoard = async () => {
    const id = activeBoardId.value;
    if (!id) return;
    try {
        await $fetch(`/api/data/board?id=${id}&userId=${userID}`, {
            method: "DELETE",
        });
        boards.value = boards.value.filter((b) => b.id !== id);
        deleteBoardModal.value = false;
        socket.emit("boardDeleted", { boardID: id });
        await nuxtApp.callHook("app:toast", { message: $t("boardDeleted") });
    } catch (err) {
        console.error("Error deleting board:", err);
        await nuxtApp.callHook("app:toast", { message: $t("error") });
    }
};

const confirmLeaveBoard = async () => {
    const id = activeBoardId.value;
    if (!id) return;
    try {
        await $fetch("/api/data/leaveBoard", {
            method: "POST",
            body: { boardId: id },
        });
        boards.value = boards.value.filter((b) => b.id !== id);
        leaveBoardModal.value = false;
        await nuxtApp.callHook("app:toast", { message: $t("boardLeft") });
    } catch (err) {
        console.error("Error leaving board:", err);
        await nuxtApp.callHook("app:toast", { message: $t("leaveBoardFailed") });
    }
};

// --- staying current -------------------------------------------------------
// Everything the tiles show — names, colours, images, who is on a board — can be
// changed by somebody else, from their dashboard or from the board itself. The
// server tells this dashboard which board changed; the whole thing is refetched
// rather than patched from the signal, because a tile also shows a member count
// and a cut of four avatars that only the server can work out.
const reload = async () => {
    try {
        const fresh: any = await $fetch("/api/data/dashboard");
        boards.value = (fresh?.boards ?? []).map((b: any) => ({ ...b }));
        groups.value = (fresh?.groups ?? []).map((g: any) => ({ ...g }));
        await nextTick();
        // The old instances point at DOM nodes that have just been replaced.
        destroySortables();
        wireBoardGrids();
    } catch (err) {
        console.error("Could not refresh the dashboard:", err);
    }
};

const onDashboardChanged = () => reload();

// Re-joined on every reconnect, like the board room is: a socket that dropped
// and came back would otherwise be in no room at all and hear nothing.
const joinDashboard = () => socket.emit("joinDashboard");

onMounted(() => {
    joinDashboard();
    socket.on("connect", joinDashboard);
    socket.on("dashboardChanged", onDashboardChanged);
});
onBeforeUnmount(() => {
    socket.off("connect", joinDashboard);
    socket.off("dashboardChanged", onDashboardChanged);
});

// One definition for the tile, so the group ones cannot drift from the original.
const newBoardTileClass =
    "bg-white dark:bg-slate cursor-pointer text-primary hover:bg-primary-hover hover:text-white min-h-48 flex flex-col justify-center items-center rounded-lg";

// `{ groupId, sort }`: where the board should be filed once it exists, and where
// in that group it should sit. The dashboard does the filing — only it knows
// when the board has been created.
defineEmits(["new-board"]);
</script>
