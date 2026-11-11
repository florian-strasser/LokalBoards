<template>
    <div class="block w-full space-y-1">
        <label class="text-sm">
            {{ props.label }}
        </label>
        <div class="flex gap-2 items-start">
            <div class="w-36 shrink-0">
                <div
                    class="aspect-square relative rounded-lg bg-slate dark:bg-white/10"
                    @click="triggerFileInput"
                    @dragover.prevent="handleDragOver"
                    @dragleave.prevent="handleDragLeave"
                    @drop.prevent="handleDrop"
                    :class="{
                        'border-2 border-dashed border-primary': isDragging,
                        'cursor-pointer': !data,
                    }"
                >
                    <img
                        v-if="data"
                        :src="data"
                        class="absolute top-0 left-0 w-full h-full object-cover rounded-lg"
                    />
                    <div
                        v-else
                        class="absolute inset-0 flex flex-col justify-center items-center text-center p-2"
                    >
                        <Plus class="size-6" />
                    </div>
                    <div v-if="data" class="absolute top-1 right-1">
                        <button
                            type="button"
                            class="flex justify-center items-center w-8 h-7 bg-primary hover:bg-primary-hover text-white rounded-md"
                            @click.stop="data = undefined"
                            v-tooltip="$t('remove')"
                        >
                            <Trash2 class="size-4" />
                        </button>
                    </div>
                </div>
                <input
                    type="file"
                    ref="fileInput"
                    accept="image/*"
                    class="hidden"
                    @change="handleFileUpload"
                />
            </div>
            <div
                class="grid gap-2 flex-1 min-w-0 content-start"
                style="
                    grid-template-columns: repeat(auto-fill, minmax(4rem, 1fr));
                "
            >
                <div v-for="image in props.images">
                    <button
                        type="button"
                        class="relative aspect-square w-full rounded-lg overflow-clip"
                        :class="{
                            'border-2 border-primary': data === image,
                        }"
                        @click="data = image"
                    >
                        <img
                            :src="image"
                            class="absolute top-0 left-0 w-full h-full object-cover"
                        />
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { Plus, Trash2 } from "@lucide/vue";

const props = defineProps({
    label: String,
    images: Array,
    // What the picture is for. A profile picture is never drawn larger than
    // 144px, so the server bounds it to that; a board's cover keeps its size.
    purpose: { type: String, default: "content" },
});

const data = defineModel();
const fileInput = ref<HTMLInputElement | null>(null);
const isDragging = ref(false);

const triggerFileInput = () => {
    if (!data.value && fileInput.value) {
        fileInput.value.click();
    }
};

const handleDragOver = (event: DragEvent) => {
    if (!data.value) {
        isDragging.value = true;
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "copy";
        }
    }
};

const handleDragLeave = () => {
    isDragging.value = false;
};

const handleDrop = (event: DragEvent) => {
    if (!data.value && event.dataTransfer?.files.length) {
        isDragging.value = false;
        const file = event.dataTransfer.files[0];
        if (file.type.startsWith("image/")) {
            uploadImage(file);
        }
    }
};

const handleFileUpload = (event: Event) => {
    const target = event.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
        const file = target.files[0];
        if (file.type.startsWith("image/")) {
            uploadImage(file);
        }
    }
};

const uploadImage = async (file: File) => {
    try {
        // Upload the file to the server
        const imageUrl = await uploadFileToServer(file);
        data.value = imageUrl;
    } catch (error) {
        console.error("Error uploading image:", error);
        // Fallback: embed the image as a full base64 data URL so it still shows
        // (a valid data URI, not the bare base64 payload).
        const fileReader = new FileReader();
        fileReader.onload = () => {
            data.value = fileReader.result;
        };
        fileReader.readAsDataURL(file);
    }
};

const uploadFileToServer = async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("purpose", props.purpose);

    // Use the image-specific endpoint, which accepts png/jpeg/gif/webp. The
    // generic /api/upload (for card attachments) only allows png/jpeg among
    // images, so webp/gif thumbnails failed there. Throw on failure so the
    // caller's base64 fallback runs.
    const response = await $fetch("/api/upload/image", {
        method: "POST",
        body: formData,
    });

    return response.imageUrl;
};
</script>
