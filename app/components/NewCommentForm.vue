<template>
    <div>
        <div v-if="!newCommentCreation" class="pt-1">
            <button
                @click="createNewComment"
                type="button"
                class="bg-primary hover:bg-primary-hover px-4 py-2 flex gap-x-1 items-center rounded-lg text-white"
            >
                <Plus class="size-5" /><span>{{ $t("writeAComment") }}</span>
            </button>
        </div>
        <form v-else @submit.prevent="createComment">
            <CardEditor v-model="newComment" />
            <div class="flex gap-x-1 mt-2">
                <input
                    type="submit"
                    class="bg-primary hover:bg-primary-hover px-4 py-2 rounded-lg text-white"
                    :value="$t('createComment')"
                />
                <button
                    type="button"
                    @click="newCommentCreation = false"
                    class="px-4 bg-primary/10 text-primary dark:bg-white/10 dark:text-white hover:bg-primary-hover hover:text-white rounded-lg"
                >
                    <X class="size-5" />
                </button>
            </div>
        </form>
    </div>
</template>
<script setup lang="ts">
import { socket } from "~/lib/socket";
import { Plus, X } from "@lucide/vue";

interface Comment {
    id: number;
    card: number;
    user: string;
    content: string;
    date: string;
}

const props = defineProps({
    cardID: Number,
});

const emit = defineEmits(["Comment-created"]);

const newCommentCreation = ref(false);
const newComment = ref("");

const createNewComment = () => {
    newComment.value = "";
    newCommentCreation.value = true;
};

const createComment = async (e) => {
    try {
        const data = await $fetch<{ comment?: Comment }>("/api/data/comment", {
            method: "POST",
            body: {
                card: props.cardID,
                content: newComment.value,
            },
        });
        if (data.comment) {
            newComment.value = "";
            newCommentCreation.value = false;
            socket.emit("commentCreated", {
                cardID: props.cardID,
                comment: data.comment,
            });
            emit("Comment-created", data.comment);
        }
    } catch (err) {
        console.error("Error creating Comment:", err);
    }
};
</script>
