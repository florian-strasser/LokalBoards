<template>
    <NuxtLinkLocale
        :to="'/board/' + props.id"
        :data-board-id="props.id"
        draggable="false"
        @dragstart.prevent
        :style="colorStyle"
        class="relative rounded-lg overflow-clip group"
        :class="color ? 'board-tile-colored' : 'bg-primary'"
    >
        <div
            class="board-tile-face relative z-20 flex flex-col gap-y-6 justify-between items-start min-h-48 px-6 py-5"
            :class="bodyHoverClass"
        >
            <!-- What the board is — unread, shared — reads from the left, where
                 a tile is read from; the menu, which is something to do rather
                 than something to know, sits opposite it. The board-style icon
                 used to be in this row too and made it busy; the board's layout
                 is obvious once it's open.

                 No `justify-between`: with neither a dot nor a badge, the menu
                 would be the only thing in the row and would end up on the left.
                 It takes the free space itself instead. -->
            <div
                class="w-full flex items-center gap-2"
                :class="color ? 'board-tile-fg' : 'text-white'"
            >
                <!-- Pulsing dot when the board has unread notifications. -->
                <span
                    v-if="props.unreadCount > 0"
                    class="relative flex size-3 shrink-0"
                >
                    <span
                        class="absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping"
                        :class="color ? 'board-tile-solid' : 'bg-white'"
                    ></span>
                    <span
                        class="relative inline-flex size-3 rounded-full shadow-md"
                        :class="color ? 'board-tile-solid' : 'bg-white'"
                    ></span>
                </span>
                <!-- "Shared" badge for boards the user doesn't own. -->
                <span
                    v-if="!props.owned"
                    class="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium"
                    :class="color ? 'board-tile-badge' : 'bg-white/20'"
                    >{{ $t("sharedBadge") }}</span
                >
                <!-- The board's own menu, the same entries its page carries, so
                     the two routine jobs — renaming it, inviting somebody — do
                     not need the board to be opened first. Rights decide what is
                     in it: the owner settles the board's settings, who is on it
                     and whether it exists; everybody else can only take
                     themselves off it, which is exactly what the page offers
                     them.

                     In this row rather than pinned to the corner: the unread
                     dot and the "shared" badge live here too, and an absolute
                     menu on top of them would have covered whichever of them
                     the board happened to have.

                     `@click.prevent.stop`, because the whole tile is a link:
                     without it, opening the menu would navigate to the board and
                     picking an entry would do both. -->
                <div
                    v-if="props.showMenu"
                    class="ml-auto shrink-0"
                    @click.prevent.stop
                >
                    <!-- Always there, not on hover: a phone has no hover, and a control
                         that only appears when the pointer is over it is not an easier
                         way to reach anything. -->
                    <ActionMenu plain floating :tooltip="$t('moreOptions')">
                        <template v-if="props.owned">
                            <button
                                type="button"
                                :class="menuItemClass"
                                @click="emit('settings', props.id)"
                            >
                                <Pencil class="size-4 shrink-0" />
                                {{ $t("boardSettings") }}
                            </button>
                            <button
                                type="button"
                                :class="menuItemClass"
                                @click="emit('invite', props.id)"
                            >
                                <UserRoundPlus class="size-4 shrink-0" />
                                {{ $t("inviteUsers") }}
                            </button>
                            <button
                                type="button"
                                :class="menuItemClass"
                                @click="emit('duplicate', props.id)"
                            >
                                <CopyPlus class="size-4 shrink-0" />
                                {{ $t("duplicateBoard") }}
                            </button>
                            <button
                                type="button"
                                :class="menuItemDestructiveClass"
                                @click="emit('delete', props.id)"
                            >
                                <Trash2 class="size-4 shrink-0" />
                                {{ $t("deleteBoard") }}
                            </button>
                        </template>
                        <button
                            v-else
                            type="button"
                            :class="menuItemDestructiveClass"
                            @click="emit('leave', props.id)"
                        >
                            <Ban class="size-4 shrink-0" />
                            {{ $t("leaveBoard") }}
                        </button>
                    </ActionMenu>
                </div>
            </div>
            <div class="flex items-end justify-between gap-3 w-full">
                <!-- The name plate is the tile's foreground colour with the
                     board's own colour as its text, so it inverts as a pair:
                     white plate on a dark board, dark plate on a pale one. -->
                <div
                    class="px-3 py-2 rounded-lg min-w-0 truncate"
                    :class="
                        color
                            ? 'board-tile-name'
                            : 'bg-white text-primary group-hover:text-primary-hover'
                    "
                >
                    {{ props.name }}
                </div>
                <!-- Collaborators: up to four avatars, then a "+N" overflow bubble. -->
                <div
                    v-if="props.members && props.members.length"
                    class="flex -space-x-2 shrink-0"
                >
                    <span
                        v-for="m in props.members"
                        :key="m.id"
                        class="size-8 rounded-full overflow-hidden flex items-center justify-center text-xs font-medium ring-2"
                        :class="
                            color
                                ? 'board-tile-avatar'
                                : 'bg-primary text-white ring-white'
                        "
                        :title="m.name"
                    >
                        <img
                            v-if="m.image"
                            :src="m.image"
                            :alt="m.name"
                            class="w-full h-full object-cover"
                        />
                        <template v-else>{{
                            (m.name || "?").charAt(0).toUpperCase()
                        }}</template>
                    </span>
                    <span
                        v-if="props.memberCount > props.members.length"
                        class="size-8 rounded-full bg-primary text-white flex items-center justify-center text-xs font-medium ring-2"
                        :class="color ? 'board-tile-ring' : 'ring-white'"
                        :title="`+${props.memberCount - props.members.length}`"
                    >
                        +{{ props.memberCount - props.members.length }}
                    </span>
                </div>
            </div>
        </div>
        <img
            v-if="props.image"
            :src="props.image"
            :alt="props.name"
            class="absolute top-0 left-0 w-full h-full object-cover z-10"
        />
    </NuxtLinkLocale>
</template>
<script setup lang="ts">
import {
    Pencil,
    UserRoundPlus,
    Trash2,
    Ban,
} from "lucide-vue-next";
import { boardTextColor, normalizeBoardColor } from "@/utils/boardColor";
const props = defineProps({
    id: Number,
    name: String,
    image: String,
    // The board's own tile colour as `#rrggbb`, or null/absent for the default
    // (the instance's primary colour).
    color: { type: String, default: null },
    // Whether the current user owns this board; false shows a "shared" badge.
    owned: { type: Boolean, default: true },
    // Up to four board members ({ id, name, image }) for the avatar stack.
    members: { type: Array as () => { id: string; name: string; image?: string }[], default: () => [] },
    // Total member count, so the tile can show a "+N" bubble beyond four avatars.
    memberCount: { type: Number, default: 0 },
    // Number of unread notifications for this user on this board; > 0 shows the
    // pulsing dot.
    unreadCount: { type: Number, default: 0 },
    // Whether to offer the board's own menu. On the dashboard, yes; anywhere a
    // tile is only a link to a board, no.
    showMenu: { type: Boolean, default: false },
});

// The board id, so whoever holds the dialogs knows which board was asked about.
const emit = defineEmits(["settings", "invite", "duplicate", "delete", "leave"]);

// The board page's and the dashboard's menu items, to the letter.
const menuItemClass =
    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-dark hover:bg-primary/10 hover:text-primary dark:text-white";
const menuItemDestructiveClass =
    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-dark hover:bg-primary-hover/10 hover:text-primary-hover dark:text-white";

// Re-validated here rather than trusted: the value is written into a CSS custom
// property, and a stored colour predating validation (or one an API client
// pushed straight into the column) must not reach the stylesheet.
const color = computed(() => normalizeBoardColor(props.color));

// Two variables drive the whole tile — the colour itself and the one readable
// thing to draw on it. Everything else (the hover shade, the translucent badge)
// is derived from them in CSS, so there is a single place the palette lives.
const colorStyle = computed(() =>
    color.value
        ? {
              "--board-color": color.value,
              "--board-fg": boardTextColor(color.value),
          }
        : undefined,
);

// What hovering does to the face of the tile, which depends on what that face is.
//
// A picture takes a translucent veil instead of a colour. This body sits above
// the image, so an opaque background here replaced the photograph with a flat
// block of primary at the moment it was pointed at; 18% of black or white leaves
// the picture visible and shifts it by as much as a coloured tile shifts.
const bodyHoverClass = computed(() => {
    if (props.image) return "board-tile-veil";
    return color.value ? "board-tile-body" : "group-hover:bg-primary-hover";
});
</script>
