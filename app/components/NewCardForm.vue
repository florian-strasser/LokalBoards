<template>
    <div>
        <!-- On a mind map the button is a round + on the area's bottom edge
             (see `.mindmap-add-card`); the form it opens is the same one. -->
        <button
            v-if="!newCardCreation && variant === 'round'"
            @click="createNewCard"
            type="button"
            data-testid="new-card-button"
            class="mindmap-add-card"
            :aria-label="$t('createNewCard')"
            v-tooltip="$t('createNewCard')"
        >
            <Plus class="size-5" />
        </button>
        <div v-else-if="!newCardCreation" class="pt-1">
            <button
                @click="createNewCard"
                type="button"
                data-testid="new-card-button"
                class="bg-primary hover:bg-primary-hover px-4 py-2 flex gap-x-1 items-center rounded-lg text-white"
            >
                <Plus class="size-5" /><span>{{ $t("createNewCard") }}</span>
            </button>
        </div>
        <form
            v-else
            @submit.prevent="createCard"
            :class="{ 'mt-2': variant === 'round' }"
        >
            <textarea
                v-model="newCardName"
                rows="2"
                ref="newCardInput"
                data-testid="new-card-input"
                :placeholder="$t('enterAnCardName')"
                class="form-control font-bold resize-none field-grows"
            />
            <div class="flex gap-x-1 mt-2">
                <input
                    type="submit"
                    data-testid="new-card-submit"
                    class="bg-primary hover:bg-primary-hover px-4 py-2 rounded-lg text-white"
                    :value="$t('createCard')"
                />
                <button
                    type="button"
                    @click="newCardCreation = false"
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
import { Plus, X } from "lucide-vue-next";

const props = defineProps({
    boardID: Number,
    areaID: Number,
    userID: String,
    // "round" is the mind map's + button; anything else is a column's.
    variant: { type: String, default: "default" },
});

const emits = defineEmits(["card-created"]);

const newCardCreation = ref(false);
const newCardName = ref("");
const newCardInput = ref(null);

const createNewCard = () => {
    newCardName.value = "";
    newCardCreation.value = true;
    nextTick(() => {
        if (newCardInput.value) {
            newCardInput.value.focus();
        }
    });
};
const createCard = async () => {
    try {
        const data = await $fetch("/api/data/card", {
            method: "POST",
            body: {
                areaId: props.areaID,
                name: newCardName.value,
                status: false, // Default status is false
                user: props.userID,
            },
        });
        if (data.card) {
            newCardName.value = "";
            newCardCreation.value = false;
            emits("card-created", data.card);
            socket.emit("cardCreated", {
                boardId: props.boardID,
                card: data.card,
            });
        }
    } catch (err) {
        console.error("Error creating card:", err);
    }
};
</script>
