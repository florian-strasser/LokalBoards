<template>
    <form @submit.prevent="save" class="text-left space-y-5">
        <div>
            <InputField
                type="text"
                name="boardName"
                :label="$t('boardName')"
                required
                v-model="name"
            />
        </div>
        <div>
            <InputImage
                :label="$t('boardThumbnail')"
                :images="placeholders"
                v-model="image"
            />
        </div>
        <div>
            <InputColor :label="$t('boardColor')" v-model="color" />
        </div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
                <label class="mb-1 block text-sm/6 font-medium text-gray">{{
                    $t("boardStyle")
                }}</label>
                <SegmentedControl
                    :values="[
                        { value: 'kanban', label: $t('kanBan') },
                        { value: 'todo', label: $t('toDo') },
                        { value: 'mindmap', label: $t('mindMap') },
                    ]"
                    name="style"
                    v-model="style"
                />
            </div>
            <div>
                <label class="mb-1 block text-sm/6 font-medium text-gray">{{
                    $t("boardStatus")
                }}</label>
                <SegmentedControl
                    :values="[
                        { value: 'private', label: $t('statusPrivate') },
                        { value: 'public', label: $t('statusPublic') },
                    ]"
                    name="status"
                    v-model="status"
                />
            </div>
        </div>
        <input
            type="submit"
            class="button bg-primary hover:bg-primary-hover w-full text-center px-6 py-3 rounded-lg text-white"
            :value="$t('saveBoard')"
        />
    </form>
</template>
<script setup lang="ts">
// The board's settings, in one place. The board page has always had this form;
// the dashboard's tile menu now opens the same one, and a form with a name, a
// thumbnail, a colour and two segmented controls is not something to keep two
// copies of — the second would be the one that stops matching.
//
// It owns the fields and the save; the page around it owns what happens next,
// because that differs: the board page updates the board it is looking at, the
// dashboard updates a tile, and both tell everyone else in their own way.
const props = defineProps({
    // The board as it stands. Watched, so opening the form for a different
    // board (or reopening it after a save) starts from the current values.
    board: { type: Object, required: true },
    // The signed-in user. The API refuses a body whose user is not the caller.
    userID: { type: String, required: true },
});

const emit = defineEmits(["saved"]);
const nuxtApp = useNuxtApp();

const placeholders = [
    "/images/board_placeholder_01.webp",
    "/images/board_placeholder_02.webp",
    "/images/board_placeholder_03.webp",
    "/images/board_placeholder_04.webp",
    "/images/board_placeholder_05.webp",
    "/images/board_placeholder_06.webp",
    "/images/board_placeholder_07.webp",
    "/images/board_placeholder_08.webp",
];

const name = ref("");
const style = ref("kanban");
const status = ref("private");
const image = ref("");
const color = ref("");

const seed = () => {
    name.value = props.board?.name ?? "";
    style.value = props.board?.style ?? "kanban";
    status.value = props.board?.status ?? "private";
    image.value = props.board?.image ?? "";
    color.value = props.board?.color ?? "";
};
watch(() => props.board, seed, { immediate: true, deep: true });

// A cover image covers the whole tile, so a colour behind one would never be
// seen. Rather than let the two silently fight, picking either clears the
// other: a board wears a picture or a colour, and the dialog always shows which
// one it is.
watch(image, (value) => {
    if (value) color.value = "";
});
watch(color, (value) => {
    if (value) image.value = "";
});

const save = async () => {
    const newName = name.value.trim();
    if (!newName) return;

    try {
        const data = await $fetch("/api/data/board", {
            method: "POST",
            body: {
                id: props.board.id,
                userId: props.userID,
                name: newName,
                style: style.value,
                image: image.value || null,
                color: color.value || null,
                status: status.value,
            },
        });
        if (!data) {
            await nuxtApp.callHook("app:toast", { message: $t("error") });
            return;
        }
        emit("saved", {
            id: props.board.id,
            name: newName,
            style: style.value,
            status: status.value,
            image: image.value || null,
            color: color.value || null,
        });
    } catch (err) {
        console.error("Error saving board:", err);
    }
};
</script>
