<template>
    <div class="min-h-svh flex flex-col justify-between overflow-clip">
        <AppHeader />
        <ContentWrapper>
            <SectionHeader
                :tooltip="$t('createNewBoard')"
                asButton
                onboardingTarget="new-board"
                @sectionHeaderButtonClicked="openCreateBoard"
            >
                {{ $t("boards") }}
                <template #actions>
                    <ActionMenu :tooltip="$t('moreOptions')">
                        <button
                            type="button"
                            @click="openImport"
                            class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-dark hover:bg-primary/10 hover:text-primary dark:text-white"
                        >
                            <Import class="size-4 shrink-0" />
                            {{ $t("importFromTrello") }}
                        </button>
                        <button
                            type="button"
                            @click="archiveModal = true"
                            class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-dark hover:bg-primary/10 hover:text-primary dark:text-white"
                        >
                            <ArchiveRestore class="size-4 shrink-0" />
                            {{ $t("archive") }}
                        </button>
                    </ActionMenu>
                </template>
            </SectionHeader>
            <BoardDashboard v-if="session" @new-board="openCreateBoard" />
        </ContentWrapper>
        <!-- The boards this account has archived. A restored board comes back
             on its own: the server tells every dashboard it belongs on. -->
        <ArchiveModal v-model="archiveModal" />
        <ModalWindow v-model="createBoard">
            <div>
                <form @submit.prevent="saveBoard" class="text-left space-y-5">
                    <div>
                        <InputField
                            type="text"
                            name="boardName"
                            :label="$t('boardName')"
                            required
                            v-model="newBoardName"
                        />
                    </div>
                    <div>
                        <InputImage
                            :label="$t('boardThumbnail')"
                            :images="[
                                '/images/board_placeholder_01.webp',
                                '/images/board_placeholder_02.webp',
                                '/images/board_placeholder_03.webp',
                                '/images/board_placeholder_04.webp',
                                '/images/board_placeholder_05.webp',
                                '/images/board_placeholder_06.webp',
                                '/images/board_placeholder_07.webp',
                                '/images/board_placeholder_08.webp',
                            ]"
                            v-model="newBoardImage"
                        />
                    </div>
                    <div>
                        <InputColor
                            :label="$t('boardColor')"
                            v-model="newBoardColor"
                        />
                    </div>
                    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                            <label
                                class="mb-1 block text-sm/6 font-medium text-gray"
                                >{{ $t("boardStyle") }}</label
                            >
                            <SegmentedControl
                                :values="[
                                    { value: 'kanban', label: $t('kanBan') },
                                    { value: 'todo', label: $t('toDo') },
                                ]"
                                name="style"
                                v-model="newBoardStyle"
                            />
                        </div>
                        <div>
                            <label
                                class="mb-1 block text-sm/6 font-medium text-gray"
                                >{{ $t("boardStatus") }}</label
                            >
                            <SegmentedControl
                                :values="[
                                    {
                                        value: 'private',
                                        label: $t('statusPrivate'),
                                    },
                                    {
                                        value: 'public',
                                        label: $t('statusPublic'),
                                    },
                                ]"
                                name="status"
                                v-model="newBoardStatus"
                            />
                        </div>
                    </div>
                    <input
                        type="submit"
                        class="button bg-primary hover:bg-primary-hover w-full text-center px-6 py-3 rounded-lg text-white"
                        :value="$t('createBoard')"
                    />
                </form>
            </div>
        </ModalWindow>
        <ModalWindow v-model="importBoard">
            <form @submit.prevent="importTrelloBoard" class="space-y-5 text-left">
                <h2 class="text-4xl text-dark dark:text-white">
                    {{ $t("importFromTrello") }}
                </h2>
                <p class="text-sm text-gray">{{ $t("trelloImportHint") }}</p>
                <label class="block w-full space-y-1">
                    <span class="block text-sm"
                        >{{ $t("trelloUrlLabel")
                        }}<span class="ml-1 text-primary">*</span></span
                    >
                    <input
                        type="url"
                        v-model="trelloUrl"
                        required
                        placeholder="https://trello.com/b/…"
                        autocomplete="off"
                        autocorrect="off"
                        autocapitalize="off"
                        spellcheck="false"
                        class="form-control"
                    />
                </label>
                <input
                    type="submit"
                    :disabled="importing"
                    :value="importing ? $t('importing') : $t('importBoardBtn')"
                    class="button w-full cursor-pointer rounded-lg bg-primary px-6 py-3 text-center text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-primary"
                />
            </form>
        </ModalWindow>
    </div>
</template>
<script setup lang="ts">
import { ArchiveRestore, Import } from "lucide-vue-next";

const nuxtApp = useNuxtApp();

useHead({
    title: $t("dashboard"),
});

const { data: session } = await useFetch("/api/auth/get-session");

const userID = session.value.data.user.id;
const createBoard = ref(false);
const archiveModal = ref(false);

// Offer the first-run guided tour to accounts that haven't been onboarded yet.
const onboarding = useOnboarding();
onMounted(() => {
    if (session.value?.data?.user && !session.value.data.user.onboarded) {
        onboarding.openPrompt();
    }
});

const newBoardName = ref($t("untitledBoard"));
const newBoardStyle = ref("kanban");
const newBoardStatus = ref("private");
const newBoardImage = ref(null);
const newBoardColor = ref("");

// The same bargain the board's own settings strike: a cover image covers the
// whole tile, so a colour behind one would never be seen. Picking either clears
// the other, and the dialog always shows which of the two the board is wearing.
watch(newBoardImage, (value) => {
    if (value) newBoardColor.value = "";
});
watch(newBoardColor, (value) => {
    if (value) newBoardImage.value = null;
});

// Where a board made from a "+" tile should be filed. The tile in a group sends
// its own id and the position at the end of it; the one above the groups sends
// null, which is the ungrouped area and needs no filing at all. Cleared on every
// open so a board created from the header button never inherits the last group
// a tile was pressed in.
const newBoardPlacement = ref<{ groupId: number | null; sort: number } | null>(
    null,
);

const openCreateBoard = (placement?: { groupId: number | null; sort: number }) => {
    newBoardPlacement.value = placement?.groupId != null ? placement : null;
    createBoard.value = true;
    setBodyScrollLock(true);
};

// --- Import a board from Trello -------------------------------------------
const importBoard = ref(false);
const trelloUrl = ref("");
const importing = ref(false);

const openImport = () => {
    trelloUrl.value = "";
    importBoard.value = true;
    setBodyScrollLock(true);
};

// Map the server's error codes to a localized message.
const trelloErrorMessage = (code) => {
    const map = {
        TRELLO_INVALID_URL: $t("trelloErrorInvalidUrl"),
        TRELLO_NOT_ACCESSIBLE: $t("trelloErrorNotAccessible"),
        TRELLO_EMPTY: $t("trelloErrorEmpty"),
    };
    return map[code] || $t("trelloErrorGeneric");
};

const importTrelloBoard = async () => {
    if (importing.value) return;
    const url = trelloUrl.value.trim();
    if (!url) return;
    importing.value = true;
    try {
        const data = await $fetch("/api/data/import/trello", {
            method: "POST",
            body: { url },
        });
        if (data?.success && data.board) {
            importBoard.value = false;
            setBodyScrollLock(false);
            await nuxtApp.callHook("app:toast", {
                message: $t("boardImported"),
            });
            await navigateTo(`/board/${data.board.id}`);
        } else {
            throw new Error(data?.error || "TRELLO_IMPORT_FAILED");
        }
    } catch (e) {
        await nuxtApp.callHook("app:toast", {
            message: trelloErrorMessage(e?.data?.error || e?.message),
        });
    } finally {
        importing.value = false;
    }
};

const saveBoard = async () => {
    const newName = newBoardName.value.trim();
    if (!newName) return;

    try {
        const data = await $fetch("/api/data/board", {
            method: "POST",
            body: {
                id: null,
                userId: userID,
                name: newName,
                style: newBoardStyle.value,
                image: newBoardImage.value,
                color: newBoardColor.value || null,
                status: newBoardStatus.value,
            },
        });
        setBodyScrollLock(false);
        if (!data) {
            await nuxtApp.callHook("app:toast", {
                message: $t("error_creating_board"),
            });
        } else {
            await nuxtApp.callHook("app:toast", {
                message: $t("boardCreated"),
            });
            // File it into the group whose tile was pressed, before leaving the
            // dashboard. A board with no placement row is ungrouped, which is
            // already the right answer for the tile above the groups — so this
            // only runs when a group asked for it. It is also not worth failing
            // the creation over: the board exists either way, and an unfiled one
            // is sitting in the ungrouped area rather than lost.
            const placement = newBoardPlacement.value;
            if (placement) {
                try {
                    await $fetch("/api/data/board-arrangement", {
                        method: "POST",
                        body: {
                            placements: [
                                {
                                    boardId: data.board.id,
                                    groupId: placement.groupId,
                                    sort: placement.sort,
                                },
                            ],
                        },
                    });
                } catch (err) {
                    console.error("Could not file the new board:", err);
                }
            }
            newBoardPlacement.value = null;

            // Advance the tour from "create a board" before moving on.
            onboarding.advance("create-board");
            await navigateTo(`/board/${data.board.id}`);
        }
    } catch (err) {
        console.error("Error:", err);
    }
};
</script>
