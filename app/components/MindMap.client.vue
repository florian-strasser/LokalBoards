<template>
    <div
        ref="viewport"
        class="mindmap-viewport"
        data-onboarding="areas"
        :class="{ 'mindmap-panning': panning }"
        @pointerdown="onViewportDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @wheel.prevent="onWheel"
    >
        <div class="mindmap-plane" :style="planeStyle">
            <!-- The branches. One SVG behind everything, drawn in plane
                 coordinates, so a line is a line at any zoom rather than
                 something that has to be kept in step with the nodes. -->
            <svg
                class="mindmap-lines"
                :style="linesStyle"
                :viewBox="viewBox"
                aria-hidden="true"
            >
                <path
                    v-for="line in lines"
                    :key="line.key"
                    :d="line.d"
                    class="mindmap-line"
                />
            </svg>

            <!-- The board itself, in the middle: the same title the other
                 layouts show above the columns. -->
            <div
                class="mindmap-node mindmap-root"
                :style="nodeStyle(place.root)"
                :class="{ 'mindmap-draggable': writeAccess }"
                @pointerdown.stop="startDrag($event, 'board', Number(boardID))"
            >
                {{ boardName }}
            </div>

            <div
                v-for="area in areas"
                :key="`area-${area.id}`"
                class="mindmap-node mindmap-area"
                :class="{ 'mindmap-draggable': writeAccess }"
                :style="nodeStyle(place.areas[area.id])"
                :data-area-id="area.id"
                :ref="(el) => setAreaEl(area.id, el)"
                @pointerdown.stop="startDrag($event, 'area', area.id)"
            >
                <div class="flex items-center gap-1">
                    <!-- The name is part of what you take hold of: a press that
                         moves drags the area, one that does not puts the caret
                         in the name, the way clicking a column's name does.
                         Once it is being typed in, a press is the text's again,
                         for moving the caret and selecting. -->
                    <input
                        v-model="area.name"
                        @blur="emits('area-renamed', area)"
                        @pointerdown="onNamePress"
                        @mousedown="holdFocus"
                        :disabled="!writeAccess"
                        class="text-dark min-w-0 shrink grow bg-transparent font-bold focus:outline-none dark:text-white"
                    />
                    <span
                        v-if="cards[area.id]?.length"
                        class="text-gray shrink-0 px-1 text-sm tabular-nums"
                    >
                        <template v-if="filtering"
                            >{{ visibleCount(area.id) }} / </template
                        >{{ cards[area.id].length }}
                    </span>
                    <button
                        v-if="writeAccess"
                        type="button"
                        @pointerdown.stop
                        @click="emits('area-deleted', area.id)"
                        class="text-primary hover:text-primary-hover shrink-0"
                        v-tooltip="$t('deleteAreaButton')"
                    >
                        <Archive class="size-5" />
                    </button>
                </div>
                <!-- The + on the node's bottom edge, where the branch to its
                     cards leaves it. Opening it grows the node with the same
                     form a column has. -->
                <div v-if="writeAccess" @pointerdown.stop>
                    <NewCardForm
                        variant="round"
                        :boardID="boardID * 1"
                        :areaID="area.id"
                        :userID="userID"
                        @card-created="emits('card-created', $event)"
                    />
                </div>
            </div>

            <div
                v-for="card in allCards"
                :key="`card-${card.id}`"
                class="mindmap-node mindmap-card"
                :class="{
                    'mindmap-draggable': writeAccess,
                    hidden: filtering && !cardVisible(card),
                    'mindmap-dragging': dragging?.kind === 'card' && dragging.id === card.id,
                }"
                :style="nodeStyle(place.cards[card.id])"
                @pointerdown.stop="startDrag($event, 'card', card.id)"
            >
                <!-- Only the title. On a map the point is the shape of the
                     work, and a tile's status, people and checklist would make
                     every node a paragraph; they are all in the card when it is
                     opened. The ring for something unread stays, because it is
                     not about the card but about what you have not seen. -->
                <button
                    type="button"
                    :data-card-id="card.id"
                    class="mindmap-card-title"
                    :class="{ 'mindmap-unread': unreadCardIds.has(card.id) }"
                    @click="onCardClick($event, card.id)"
                >
                    {{ card.name }}
                </button>
            </div>
        </div>

        <!-- What the map can do, out of the way in a corner. -->
        <div class="mindmap-tools">
            <button
                v-if="writeAccess"
                type="button"
                @click="emits('area-new')"
                data-onboarding="new-area"
                class="mindmap-tool mindmap-tool-wide"
            >
                <Plus :stroke-width="1.5" class="size-5" />
                <span>{{ $t("createNewArea") }}</span>
            </button>
            <button
                type="button"
                @click="zoomBy(1.2)"
                class="mindmap-tool"
                :aria-label="$t('zoomIn')"
                v-tooltip="$t('zoomIn')"
            >
                <ZoomIn class="size-5" />
            </button>
            <button
                type="button"
                @click="zoomBy(1 / 1.2)"
                class="mindmap-tool"
                :aria-label="$t('zoomOut')"
                v-tooltip="$t('zoomOut')"
            >
                <ZoomOut class="size-5" />
            </button>
            <button
                type="button"
                @click="refit()"
                class="mindmap-tool"
                :aria-label="$t('fitToScreen')"
                v-tooltip="$t('fitToScreen')"
            >
                <Maximize class="size-5" />
            </button>
        </div>
    </div>
</template>

<script setup>
// A board as a mind map.
//
// The board's title is the node in the middle, its areas branch off it and each
// area's cards branch off their area — the same board, the same areas and the
// same cards as the columns, drawn as a tree and moved about by hand. Where a
// node sits is stored on the board (see `app/utils/mindMap.ts` and
// `server/api/data/mindmap.ts`) and is shared, like the order of the columns:
// what everybody sees is arranged the same. What is *not* stored is the pan and
// the zoom, which are yours and last as long as you are looking.
//
// Nothing here changes what a card or an area is, so switching the board back
// to columns loses nothing: `sort` still says what the order is, and dragging a
// card onto another area is the same move as dragging it into another column.
import { Archive, Maximize, Plus, ZoomIn, ZoomOut } from "lucide-vue-next";
import { clampToMap, mapBounds, placeMap } from "~/utils/mindMap";
import { socket } from "~/lib/socket";

const props = defineProps({
    boardID: { type: [String, Number], required: true },
    boardName: { type: String, default: "" },
    board: { type: Object, default: () => ({}) },
    areas: { type: Array, default: () => [] },
    cards: { type: Object, default: () => ({}) },
    writeAccess: { type: Boolean, default: false },
    userID: { type: String, default: "" },
    filtering: { type: Boolean, default: false },
    cardVisible: { type: Function, default: () => true },
    unreadCardIds: { type: Object, default: () => new Set() },
    cardModal: { type: [String, Number, Boolean, Object], default: false },
});
const emits = defineEmits([
    "update:cardModal",
    "card-created",
    "card-moved",
    "area-new",
    "area-renamed",
    "area-deleted",
]);

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
// Far enough that a click cannot move a card by accident, close enough that a
// deliberate nudge still counts.
const DRAG_START = 4;

const viewport = ref(null);
const zoom = ref(1);
const pan = reactive({ x: 0, y: 0 });
const panning = ref(false);
const dragging = ref(null);
// Where a node has been dragged to but not yet saved, so the map draws the new
// place immediately and the board's own data stays the truth until it is.
const pending = reactive({ board: {}, areas: {}, cards: {} });

// Every card of the board, in the order its areas are in — the list the map
// draws, since a card is a node of its own rather than a row inside a column.
const allCards = computed(() =>
    props.areas.flatMap((area) => props.cards[area.id] ?? []),
);

const visibleCount = (areaId) =>
    (props.cards[areaId] ?? []).filter((card) => props.cardVisible(card)).length;

// Where everything sits: what the board says, with anything dragged in this
// moment on top of it.
const place = computed(() => {
    const laid = placeMap(
        {
            areas: props.areas.map((area) => ({
                id: area.id,
                mapX: area.mapX,
                mapY: area.mapY,
            })),
            cards: Object.fromEntries(
                props.areas.map((area) => [
                    area.id,
                    (props.cards[area.id] ?? []).map((card) => ({
                        id: card.id,
                        mapX: card.mapX,
                        mapY: card.mapY,
                    })),
                ]),
            ),
        },
        { mapX: props.board?.mapX, mapY: props.board?.mapY },
    );
    if (pending.board.x !== undefined) laid.root = { ...pending.board };
    for (const [id, at] of Object.entries(pending.areas)) laid.areas[id] = { ...at };
    for (const [id, at] of Object.entries(pending.cards)) laid.cards[id] = { ...at };
    return laid;
});

const lines = computed(() => {
    const out = [];
    for (const area of props.areas) {
        const from = place.value.root;
        const to = place.value.areas[area.id];
        if (to) out.push({ key: `a${area.id}`, d: curve(from, to) });
        for (const card of props.cards[area.id] ?? []) {
            if (props.filtering && !props.cardVisible(card)) continue;
            const at = place.value.cards[card.id];
            if (to && at) out.push({ key: `c${card.id}`, d: curve(to, at) });
        }
    }
    return out;
});

// A branch bends rather than cuts straight across: the control points sit on
// the midpoint's own axis, which makes a line leave its node roughly the way it
// arrives at the next one.
function curve(from, to) {
    const midX = (from.x + to.x) / 2;
    return `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`;
}

// The SVG has no size of its own — it is a plane, and the box it draws in has
// to hold negative coordinates, which is what the viewBox is for.
const linesBox = computed(() => mapBounds(place.value, 400));
const linesStyle = computed(() => ({
    left: `${linesBox.value.x}px`,
    top: `${linesBox.value.y}px`,
    width: `${linesBox.value.width}px`,
    height: `${linesBox.value.height}px`,
}));
const viewBox = computed(
    () =>
        `${linesBox.value.x} ${linesBox.value.y} ${linesBox.value.width} ${linesBox.value.height}`,
);

const planeStyle = computed(() => ({
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom.value})`,
}));
const nodeStyle = (at) =>
    at ? { left: `${at.x}px`, top: `${at.y}px` } : { display: "none" };

// --- Panning and zooming ----------------------------------------------------
const pointers = new Map();
let pinch = null;

const onViewportDown = (event) => {
    // A press on a control is the control's. Panning captures the pointer, and
    // a captured release lands on the map instead of the button it was pressed
    // on — which the browser does not count as a click, so the button would
    // never fire. That is how the corner's buttons were dead for a while.
    if (event.target.closest?.("button, a, input, textarea, select, label"))
        return;
    touched.value = true;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) return startPinch();
    panning.value = true;
    viewport.value?.setPointerCapture?.(event.pointerId);
};

const startPinch = () => {
    const [a, b] = [...pointers.values()];
    pinch = {
        distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        zoom: zoom.value,
        pan: { ...pan },
    };
    panning.value = false;
    dragging.value = null;
};

const onPointerMove = (event) => {
    if (pointers.has(event.pointerId)) {
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const next = clampZoom(pinch.zoom * (distance / pinch.distance));
        // Zoom about the point between the fingers, and follow them as they move.
        const rect = viewport.value.getBoundingClientRect();
        const origin = {
            x: pinch.mid.x - rect.left - rect.width / 2,
            y: pinch.mid.y - rect.top - rect.height / 2,
        };
        const scale = next / pinch.zoom;
        pan.x = mid.x - pinch.mid.x + origin.x - (origin.x - pinch.pan.x) * scale;
        pan.y = mid.y - pinch.mid.y + origin.y - (origin.y - pinch.pan.y) * scale;
        zoom.value = next;
        return;
    }
    if (dragging.value) return moveDrag(event);
    if (!panning.value) return;
    pan.x += event.movementX;
    pan.y += event.movementY;
};

const onPointerUp = (event) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (dragging.value) return endDrag(event);
    panning.value = false;
};

const clampZoom = (value) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));

// A trackpad pinch arrives as a wheel event with ctrlKey set, which is how a
// browser says "zoom"; two fingers without it mean scroll, and on a map that
// is panning.
const onWheel = (event) => {
    touched.value = true;
    if (event.ctrlKey || event.metaKey) {
        const rect = viewport.value.getBoundingClientRect();
        zoomAt(
            Math.exp(-event.deltaY / 200),
            event.clientX - rect.left - rect.width / 2,
            event.clientY - rect.top - rect.height / 2,
        );
    } else {
        pan.x -= event.deltaX;
        pan.y -= event.deltaY;
    }
};

// Zoom keeping the point under the cursor under the cursor.
const zoomAt = (factor, originX, originY) => {
    const next = clampZoom(zoom.value * factor);
    const scale = next / zoom.value;
    pan.x = originX - (originX - pan.x) * scale;
    pan.y = originY - (originY - pan.y) * scale;
    zoom.value = next;
};
const zoomBy = (factor) => {
    touched.value = true;
    zoomAt(factor, 0, 0);
};

// Everything on screen at once, never blown up past its own size. The margin
// is generous because the bounds are worked out from where nodes *sit*, and a
// node is 16rem wide around that point.
const fit = () => {
    const el = viewport.value;
    if (!el || !el.clientWidth || !el.clientHeight) return false;
    const box = mapBounds(place.value, 240);
    const next = clampZoom(
        Math.min(el.clientWidth / box.width, el.clientHeight / box.height, 1),
    );
    zoom.value = next;
    pan.x = -(box.x + box.width / 2) * next;
    pan.y = -(box.y + box.height / 2) * next;
    return true;
};

// Until somebody moves the map themselves it keeps framing itself: on the
// first render, when the pane it is drawn in settles to its real size, and
// when the window changes shape. The moment they pan, zoom or drag anything,
// the view is theirs and nothing moves it again.
const touched = ref(false);
let watchSize = null;
onMounted(() => {
    nextTick(fit);
    watchSize = new ResizeObserver(() => {
        if (!touched.value) fit();
    });
    if (viewport.value) watchSize.observe(viewport.value);
});
onBeforeUnmount(() => watchSize?.disconnect());

// --- Dragging a node --------------------------------------------------------
const areaEls = new Map();
const setAreaEl = (id, el) => {
    if (el) areaEls.set(id, el);
    else areaEls.delete(id);
};

// A card is dragged by its title, and the title is a button: every drag ends in
// a click on it. So for somebody who can drag, the drag decides — a press that
// moved was a drag, one that did not opens the card (where the drag ends,
// below). A click with no pointer behind it is Enter on the focused title, and
// somebody who can only read has nothing to drag: for them a click is a click.
const onCardClick = (event, id) => {
    if (props.writeAccess && event.detail !== 0) return;
    emits("update:cardModal", id);
};

// The area's name. Pressed while it is being edited, the press belongs to the
// text and the area stays where it is; otherwise it goes on to the node and may
// become a drag.
const onNamePress = (event) => {
    if (document.activeElement === event.currentTarget) event.stopPropagation();
};
// A text field takes the focus the moment it is pressed, which would put a
// caret in the name at the start of every drag. It is held back until the
// press turns out not to have been one (see `endDrag`).
const holdFocus = (event) => {
    if (props.writeAccess && document.activeElement !== event.currentTarget)
        event.preventDefault();
};

const startDrag = (event, kind, id) => {
    if (!props.writeAccess || event.button !== 0 || pointers.size > 1) return;
    touched.value = true;
    const at =
        kind === "board"
            ? place.value.root
            : kind === "area"
              ? place.value.areas[id]
              : place.value.cards[id];
    if (!at) return;
    dragging.value = {
        kind,
        id,
        pointerId: event.pointerId,
        from: { x: event.clientX, y: event.clientY },
        start: { ...at },
        // An area takes its cards with it: a branch moves as a branch.
        followers:
            kind === "area"
                ? (props.cards[id] ?? []).map((card) => ({
                      id: card.id,
                      start: { ...place.value.cards[card.id] },
                  }))
                : [],
        moved: false,
        // Pressed on the area's name: if this turns out to be a click, that is
        // where the caret goes.
        name: event.target instanceof HTMLInputElement ? event.target : null,
    };
    event.target.setPointerCapture?.(event.pointerId);
};

const moveDrag = (event) => {
    const drag = dragging.value;
    const dx = (event.clientX - drag.from.x) / zoom.value;
    const dy = (event.clientY - drag.from.y) / zoom.value;
    if (!drag.moved && Math.hypot(dx, dy) * zoom.value < DRAG_START) return;
    drag.moved = true;
    const to = { x: Math.round(drag.start.x + dx), y: Math.round(drag.start.y + dy) };
    if (drag.kind === "board") pending.board = to;
    else if (drag.kind === "area") {
        pending.areas[drag.id] = to;
        for (const follower of drag.followers) {
            pending.cards[follower.id] = {
                x: Math.round(follower.start.x + dx),
                y: Math.round(follower.start.y + dy),
            };
        }
    } else pending.cards[drag.id] = to;
};

const endDrag = async (event) => {
    const drag = dragging.value;
    dragging.value = null;
    panning.value = false;
    if (!drag?.moved) {
        // Pressed and let go without moving: that is opening the card, or
        // clicking into the area's name to rename it.
        if (drag?.kind === "card") emits("update:cardModal", drag.id);
        if (drag?.name) {
            drag.name.focus();
            const end = drag.name.value.length;
            drag.name.setSelectionRange(end, end);
        }
        return;
    }

    const nodes = [];
    if (drag.kind === "board") {
        nodes.push({ kind: "board", id: Number(props.boardID), ...pending.board });
    } else if (drag.kind === "area") {
        nodes.push({ kind: "area", id: drag.id, ...pending.areas[drag.id] });
        for (const follower of drag.followers) {
            nodes.push({ kind: "card", id: follower.id, ...pending.cards[follower.id] });
        }
    } else {
        nodes.push({ kind: "card", id: drag.id, ...pending.cards[drag.id] });
    }

    // Dropped on another area's node, the card joins it — the same move as
    // dragging it into another column, and the column's order decides where.
    if (drag.kind === "card") {
        const onto = areaUnder(event.clientX, event.clientY);
        const card = allCards.value.find((c) => Number(c.id) === Number(drag.id));
        if (onto && card && Number(onto) !== Number(card.area)) {
            emits("card-moved", {
                cardId: card.id,
                fromAreaId: card.area,
                toAreaId: onto,
                newIndex: (props.cards[onto] ?? []).length,
            });
        }
    }

    await save(nodes);
};

// Which area node is under a point on the screen, if any.
const areaUnder = (clientX, clientY) => {
    for (const [id, el] of areaEls) {
        const rect = el?.getBoundingClientRect?.();
        if (!rect) continue;
        if (
            clientX >= rect.left &&
            clientX <= rect.right &&
            clientY >= rect.top &&
            clientY <= rect.bottom
        )
            return Number(id);
    }
    return null;
};

const save = async (nodes) => {
    const clean = nodes
        .map((node) => ({
            kind: node.kind,
            id: node.id,
            x: clampToMap(node.x),
            y: clampToMap(node.y),
        }))
        .filter((node) => node.x !== null && node.y !== null);
    if (!clean.length) return;
    try {
        await $fetch("/api/data/mindmap", {
            method: "POST",
            body: { boardId: props.boardID * 1, nodes: clean },
        });
        // The board holds it now, so the local copy can let go of it.
        applyMoved(clean);
        socket.emit("mapMoved", { boardId: props.boardID * 1, nodes: clean });
    } catch (error) {
        console.error("Could not save the map:", error);
        pending.board = {};
        for (const key of Object.keys(pending.areas)) delete pending.areas[key];
        for (const key of Object.keys(pending.cards)) delete pending.cards[key];
    }
};

// Write a move into the board's own data — ours once it is saved, somebody
// else's when it arrives over the socket.
const applyMoved = (nodes) => {
    for (const node of nodes) {
        if (node.kind === "board") {
            props.board.mapX = node.x;
            props.board.mapY = node.y;
            pending.board = {};
        } else if (node.kind === "area") {
            const area = props.areas.find((a) => Number(a.id) === Number(node.id));
            if (area) {
                area.mapX = node.x;
                area.mapY = node.y;
            }
            delete pending.areas[node.id];
        } else {
            const card = allCards.value.find((c) => Number(c.id) === Number(node.id));
            if (card) {
                card.mapX = node.x;
                card.mapY = node.y;
            }
            delete pending.cards[node.id];
        }
    }
};

// Fitting by hand is asking the map to take the view back over.
const refit = () => {
    touched.value = false;
    fit();
};

</script>
