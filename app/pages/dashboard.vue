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
                <!-- Two views of the same work, side by side as two headings
                     rather than one more entry in the navigation: the boards
                     you are on, and the cards on you across all of them. Each
                     has its own address, so My work can be bookmarked.

                     Only from md up. Below that there is no room for both names
                     at heading size — in Czech, German, French, Italian and
                     Portuguese not even at 640 pixels — so a narrow screen names
                     the view it is showing, and the switch sits under it. -->
                <!-- Only for somebody with work to show. Without an open card
                     on them the heading is Boards and nothing else, as it was
                     before My work existed. -->
                <template v-if="hasMyWork">
                <span class="md:hidden">{{
                    myWork ? $t("myWork") : $t("boards")
                }}</span>
                <span
                    class="hidden flex-wrap items-baseline gap-x-6 gap-y-1 md:flex"
                >
                    <NuxtLink
                        to="/dashboard/"
                        :class="viewClass(!myWork)"
                        :aria-current="myWork ? undefined : 'page'"
                        >{{ $t("boards") }}</NuxtLink
                    >
                    <NuxtLink
                        to="/dashboard/?view=mine"
                        :class="viewClass(myWork)"
                        :aria-current="myWork ? 'page' : undefined"
                        >{{ $t("myWork") }}</NuxtLink
                    >
                </span>
                </template>
                <template v-else>{{ $t("boards") }}</template>
                <template #actions>
                    <ActionMenu :tooltip="$t('moreOptions')">
                        <button
                            type="button"
                            @click="openImport"
                            class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-dark hover:bg-primary/10 hover:text-primary dark:text-white"
                        >
                            <Import class="size-4 shrink-0" />
                            {{ $t("importBoards") }}
                        </button>
                        <button
                            type="button"
                            @click="archiveModal = true"
                            class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-dark hover:bg-primary/10 hover:text-primary dark:text-white"
                        >
                            <ArchiveRestore class="size-4 shrink-0" />
                            {{ $t("archive") }}
                        </button>
                        <!-- What My work is showing, as rows for a
                             spreadsheet. Only on that view: it is an export of
                             the list in front of you. -->
                        <button
                            v-if="myWork"
                            type="button"
                            @click="startDownload('/api/data/my-work?format=csv')"
                            class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-dark hover:bg-primary/10 hover:text-primary dark:text-white"
                        >
                            <FileSpreadsheet class="size-4 shrink-0" />
                            {{ $t("exportSpreadsheet") }}
                        </button>
                    </ActionMenu>
                </template>
            </SectionHeader>
            <div v-if="hasMyWork" class="-mt-4 mb-8 md:hidden">
                <SegmentedControl
                    :values="[
                        { value: 'boards', label: $t('boards') },
                        { value: 'mine', label: $t('myWork') },
                    ]"
                    name="dashboardView"
                    v-model="view"
                />
            </div>
            <MyWork v-if="session && myWork" />
            <BoardDashboard
                v-else-if="session"
                @new-board="openCreateBoard"
            />
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
        <!-- Two ways in, one dialog: Trello is read from a public board's
             link, the others from the export file they write. Which of those
             tools a file came from is read from the file, so choosing it is
             all there is to do. -->
        <ModalWindow v-model="importBoard">
            <div class="space-y-8 text-left">
            <h2 class="text-4xl text-dark dark:text-white">
                {{ $t("importBoards") }}
            </h2>
            <form @submit.prevent="importTrelloBoard" class="space-y-5">
                <h3 class="text-xl font-bold text-dark dark:text-white">
                    {{ $t("importFromTrello") }}
                </h3>
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
            <!-- A private Trello board's files are only handed to somebody
                 signed in to Trello. The person importing is, so they can
                 lend the import that: allow LokalBoards to read their boards
                 for an hour, paste the token Trello shows, and the files come
                 along. Asked only when it matters — a Trello file, of a
                 private board, that has files. -->
            <div v-if="pendingTrello" class="space-y-5">
                <h3 class="text-xl font-bold text-dark dark:text-white">
                    {{ $t("trelloFilesHeading") }}
                </h3>
                <p class="text-sm text-gray">{{ $t("trelloFilesHint") }}</p>
                <a
                    :href="trelloAuthorizeUrl"
                    target="_blank"
                    rel="noopener"
                    class="button flex w-full items-center justify-center gap-2 rounded-lg bg-primary/10 px-6 py-3 text-center text-primary hover:bg-primary hover:text-white dark:bg-white/10 dark:text-white"
                >
                    <ExternalLink class="size-5 shrink-0" />
                    <span>{{ $t("trelloAllowButton") }}</span>
                </a>
                <label class="block w-full space-y-1">
                    <span class="block text-sm">{{
                        $t("trelloTokenLabel")
                    }}</span>
                    <input
                        v-model="trelloToken"
                        type="text"
                        autocomplete="off"
                        autocorrect="off"
                        autocapitalize="off"
                        spellcheck="false"
                        data-testid="trello-token"
                        class="form-control font-mono text-sm"
                    />
                </label>
                <button
                    type="button"
                    :disabled="importing || !trelloToken.trim()"
                    @click="sendImportFile(pendingTrello, trelloToken.trim())"
                    class="button w-full cursor-pointer rounded-lg bg-primary px-6 py-3 text-center text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-primary"
                >
                    {{ importing ? $t("importing") : $t("trelloImportWithFiles") }}
                </button>
                <button
                    type="button"
                    :disabled="importing"
                    @click="sendImportFile(pendingTrello, '')"
                    class="w-full text-center text-sm text-primary hover:text-primary-hover disabled:opacity-50"
                >
                    {{ $t("trelloImportWithoutFiles") }}
                </button>
            </div>
            <div v-else class="space-y-5">
                <h3 class="text-xl font-bold text-dark dark:text-white">
                    {{ $t("importFromFile") }}
                </h3>
                <p class="text-sm text-gray">{{ $t("importFileHint") }}</p>
                <label
                    class="button flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3 text-center text-white hover:bg-primary-hover"
                    :class="{
                        'pointer-events-none opacity-50': importing,
                    }"
                >
                    <Upload class="size-5 shrink-0" />
                    <span>{{
                        importing ? $t("importing") : $t("importFileButton")
                    }}</span>
                    <input
                        type="file"
                        accept=".json,application/json"
                        class="sr-only"
                        :disabled="importing"
                        data-testid="import-file"
                        @change="importFile"
                    />
                </label>
            </div>
            </div>
        </ModalWindow>
    </div>
</template>
<script setup lang="ts">
import {
    ArchiveRestore,
    ExternalLink,
    FileSpreadsheet,
    Import,
    Upload,
} from "lucide-vue-next";

const nuxtApp = useNuxtApp();

useHead({
    title: $t("dashboard"),
});

const { data: session } = await useFetch("/api/auth/get-session");

const userID = session.value.data.user.id;
const createBoard = ref(false);
const archiveModal = ref(false);

const route = useRoute();

// Whether My work has anything in it: an open card assigned to you, not
// archived, on a board you are still on — counted by the same query the view
// lists from. Without one, neither the switch nor the view is offered; a
// heading that leads to "nothing is assigned to you" only raises the question
// of what it was for. Asked on every visit, so the switch is there the first
// time something is assigned.
const { data: workCount } = await useFetch("/api/data/my-work", {
    query: { count: 1 },
});
const hasMyWork = computed(() => Number(workCount.value?.count ?? 0) > 0);
const myWork = computed(
    () => hasMyWork.value && route.query.view === "mine",
);
// A bookmark or a link to My work, followed with nothing in it, lands on the
// boards rather than on an empty view.
if (route.query.view === "mine" && !hasMyWork.value) {
    await navigateTo("/dashboard/", { replace: true });
}
// The narrow layout's switch. Setting it goes to the view's address, so Back
// and a bookmark behave the same whichever of the two was used.
const view = computed({
    get: () => (myWork.value ? "mine" : "boards"),
    set: (value) =>
        navigateTo(value === "mine" ? "/dashboard/?view=mine" : "/dashboard/"),
});
const viewClass = (active: boolean) =>
    active
        ? "text-dark dark:text-white"
        : "text-gray hover:text-primary dark:hover:text-white";

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
    pendingTrello.value = null;
    trelloToken.value = "";
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

// An export file from Wekan or Nextcloud Deck, sent as it is: the server reads
// which of them wrote it. A Deck export can hold several boards; the first one
// opens, and the toast says how many came across.
const fileErrorMessage = (code) => {
    const map = {
        IMPORT_UNKNOWN_FORMAT: $t("importFileErrorUnknown"),
        IMPORT_EMPTY: $t("importFileErrorEmpty"),
        IMPORT_TOO_LARGE: $t("importFileErrorTooLarge"),
    };
    return map[code] || $t("trelloErrorGeneric");
};

// A private Trello board's files need the importer's own Trello access. The
// file is looked at here first, and the token step shown only for a Trello
// export of a private board that has files — and only on an instance that has
// a Trello API key to ask for a token with.
const trelloApiKey = String(useRuntimeConfig().public.trelloApiKey || "");
const pendingTrello = ref(null);
const trelloToken = ref("");
const trelloAuthorizeUrl = computed(
    () =>
        `https://trello.com/1/authorize?expiration=1hour&scope=read&response_type=token&name=LokalBoards&key=${encodeURIComponent(trelloApiKey)}`,
);

const needsTrelloAccess = (json) =>
    !!json &&
    typeof json.shortLink === "string" &&
    Array.isArray(json.lists) &&
    Array.isArray(json.cards) &&
    json._format === undefined &&
    json.prefs?.permissionLevel !== "public" &&
    json.cards.some(
        (card) =>
            !card.closed &&
            ((card.attachments || []).some((file) => file.isUpload) ||
                /trello\.com\/1\/cards\/[^\s)]*\/attachments\//.test(
                    card.desc || "",
                )),
    );

const importFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || importing.value) return;
    if (trelloApiKey) {
        let json = null;
        try {
            json = JSON.parse(await file.text());
        } catch {
            // Not JSON at all: the server says so in the usual way.
        }
        if (needsTrelloAccess(json)) {
            trelloToken.value = "";
            pendingTrello.value = file;
            return;
        }
    }
    await sendImportFile(file, "");
};

const sendImportFile = async (file, token) => {
    if (importing.value) return;
    importing.value = true;
    try {
        const data = await $fetch("/api/data/import/file", {
            method: "POST",
            body: file,
            headers: {
                "content-type": "application/json",
                ...(token ? { "x-trello-token": token } : {}),
            },
        });
        if (!data?.success || !data.boards?.length) {
            throw new Error(data?.error || "IMPORT_FAILED");
        }
        importBoard.value = false;
        pendingTrello.value = null;
        trelloToken.value = "";
        setBodyScrollLock(false);
        await nuxtApp.callHook("app:toast", {
            message:
                data.boards.length === 1
                    ? $t("boardImported")
                    : $t("boardsImported", { count: data.boards.length }),
        });
        // Honest about what stayed behind: those files are links on their
        // cards now, and this is the moment to know it.
        if (data.linked) {
            await nuxtApp.callHook("app:toast", {
                message: $t("importFilesLinked", { count: data.linked }),
            });
        }
        await navigateTo(`/board/${data.boards[0].id}`);
    } catch (e) {
        await nuxtApp.callHook("app:toast", {
            message: fileErrorMessage(e?.data?.error || e?.message),
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
