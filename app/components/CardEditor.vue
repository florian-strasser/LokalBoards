<template>
    <div>
        <ul
            v-if="emojiSelect && editor"
            class="editor-toolbar flex gap-2 flex-wrap items-center mb-1"
        >
            <li>
                <button
                    type="button"
                    @click="emojiSelect = false"
                    class="block hover:text-primary-hover"
                    v-tooltip="$t('back')"
                >
                    <ArrowLeft class="size-5" />
                </button>
            </li>
            <li v-for="item in emojiList">
                <button class="block" @click="setEmoji(item.code)">
                    {{ item.icon }}
                </button>
            </li>
        </ul>
        <ul
            v-else-if="editor"
            class="editor-toolbar flex gap-2 flex-wrap py-0.5 mb-1"
        >
            <li>
                <button
                    type="button"
                    @click="editor.chain().focus().toggleBold().run()"
                    :disabled="!editor.can().chain().focus().toggleBold().run()"
                    class="block hover:text-primary-hover"
                    :class="{ 'text-primary': editor.isActive('bold') }"
                    v-tooltip="$t('editorBold')"
                >
                    <Bold class="size-5" />
                </button>
            </li>
            <li>
                <button
                    type="button"
                    @click="editor.chain().focus().toggleItalic().run()"
                    :disabled="
                        !editor.can().chain().focus().toggleItalic().run()
                    "
                    class="block hover:text-primary-hover"
                    :class="{ 'text-primary': editor.isActive('italic') }"
                    v-tooltip="$t('editorItalic')"
                >
                    <Italic class="size-5" />
                </button>
            </li>
            <li>
                <button
                    type="button"
                    @click="editor.chain().focus().toggleStrike().run()"
                    :disabled="
                        !editor.can().chain().focus().toggleStrike().run()
                    "
                    class="block hover:text-primary-hover"
                    :class="{ 'text-primary': editor.isActive('strike') }"
                    v-tooltip="$t('editorStrike')"
                >
                    <Strikethrough class="size-5" />
                </button>
            </li>
            <li>
                <button
                    type="button"
                    @click="editor.chain().focus().toggleBulletList().run()"
                    class="block hover:text-primary-hover"
                    :class="{ 'text-primary': editor.isActive('bulletList') }"
                    v-tooltip="$t('editorBulletList')"
                >
                    <List class="size-5" />
                </button>
            </li>
            <li>
                <button
                    type="button"
                    @click="editor.chain().focus().toggleOrderedList().run()"
                    class="block hover:text-primary-hover"
                    :class="{
                        'text-primary': editor.isActive('orderedList'),
                    }"
                    v-tooltip="$t('editorOrderedList')"
                >
                    <ListOrdered class="size-5" />
                </button>
            </li>
            <li>
                <button
                    type="button"
                    @click="editor.chain().focus().toggleTaskList().run()"
                    class="block hover:text-primary-hover"
                    :class="{
                        'text-primary': editor.isActive('taskList'),
                    }"
                    v-tooltip="$t('editorCheckList')"
                >
                    <ListChecks class="size-5" />
                </button>
            </li>
            <li>
                <button
                    type="button"
                    @click="addImage"
                    class="block hover:text-primary-hover"
                    :class="{ 'text-primary': editor.isActive('image') }"
                    v-tooltip="$t('editorImage')"
                >
                    <FileImage class="size-5" />
                </button>
            </li>
            <li>
                <button
                    type="button"
                    @click="editor.chain().focus().toggleCodeBlock().run()"
                    class="block hover:text-primary-hover"
                    :class="{ 'text-primary': editor.isActive('codeBlock') }"
                    v-tooltip="$t('editorCodeblock')"
                >
                    <Code class="size-5" />
                </button>
            </li>
            <li>
                <button
                    type="button"
                    @click="emojiSelect = true"
                    class="block hover:text-primary-hover"
                    v-tooltip="$t('editorEmojis')"
                >
                    <Smile class="size-5" />
                </button>
            </li>
        </ul>
        <EditorContent :editor="editor" />
    </div>
</template>
<script setup lang="ts">
import {
    Bold,
    Italic,
    Strikethrough,
    List,
    ListOrdered,
    FileImage,
    Code,
    ListChecks,
    Smile,
    ArrowLeft,
} from "lucide-vue-next";
import { useEditor, EditorContent } from "@tiptap/vue-3";
import { Placeholder } from "@tiptap/extensions";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Image from "@tiptap/extension-image";
import Emoji, { emojis } from "@tiptap/extension-emoji";
import FileHandler from "@tiptap/extension-file-handler";
import StarterKit from "@tiptap/starter-kit";

const model = defineModel();
const emojiSelect = ref(false);

const emojiList = [
    { icon: "👍", code: "+1" },
    { icon: "👎", code: "-1" },
    { icon: "😄", code: "smile" },
    { icon: "😢", code: "cry" },
    { icon: "😓", code: "sweat" },
    { icon: "🎉", code: "party" },
    { icon: "🔥", code: "fire" },
    { icon: "🚀", code: "rocket" },
];

const editor = useEditor({
    // The model is Markdown; TipTap works in HTML, so convert on load/save.
    content: markdownToHtml(model.value),
    extensions: [
        StarterKit.configure({
            Heading: false,
        }),
        Placeholder.configure({
            placeholder: $t("writeSomething"),
        }),
        Image.configure({
            allowBase64: false, // Disable base64, we'll use URLs
        }),
        Emoji.configure({
            emojis: emojis,
            enableEmoticons: true,
        }),
        FileHandler.configure({
            // Take the paste and stop, rather than uploading the image and
            // letting the editor paste the clipboard's HTML on top of it.
            //
            // "Copy image" in a browser puts two things on the clipboard: the
            // picture itself, and a scrap of `text/html` holding an `<img>` that
            // points back where it came from. Without this the handler below
            // uploads the file *and* returns the paste to ProseMirror, which
            // then inserts that `<img>` as well — two pictures, of which only
            // the uploaded one survives a save, because the other one points at
            // a page that is not ours.
            //
            // The handler only ever sees pastes that carry a file of an allowed
            // type, so text and HTML on their own paste exactly as before.
            consumePasteEvent: true,
            allowedMimeTypes: [
                "image/png",
                "image/jpg",
                "image/jpeg",
                "image/gif",
                "image/webp",
                "image/avif",
            ],
            onDrop: async (currentEditor, files, pos) => {
                for (const file of files) {
                    try {
                        const response = await uploadImage(file);
                        if (response.image) {
                            currentEditor
                                .chain()
                                .insertContentAt(pos, {
                                    type: "image",
                                    attrs: {
                                        src: response.image,
                                    },
                                })
                                .focus()
                                .run();
                        }
                    } catch (error) {
                        console.error("Failed to upload image:", error);
                        // Fallback to base64 if upload fails
                        const fileReader = new FileReader();
                        fileReader.readAsDataURL(file);
                        fileReader.onload = () => {
                            currentEditor
                                .chain()
                                .insertContentAt(pos, {
                                    type: "image",
                                    attrs: {
                                        src: fileReader.result,
                                    },
                                })
                                .focus()
                                .run();
                        };
                    }
                }
                model.value = htmlToMarkdown(editor.value.getHTML());
            },
            onPaste: async (currentEditor, files) => {
                for (const file of files) {
                    try {
                        const response = await uploadImage(file);
                        if (response.image) {
                            currentEditor
                                .chain()
                                .insertContentAt(
                                    currentEditor.state.selection.anchor,
                                    {
                                        type: "image",
                                        attrs: {
                                            src: response.image,
                                        },
                                    },
                                )
                                .focus()
                                .run();
                        }
                    } catch (error) {
                        console.error("Failed to upload image:", error);
                        // Fallback to base64 if upload fails
                        const fileReader = new FileReader();
                        fileReader.readAsDataURL(file);
                        fileReader.onload = () => {
                            currentEditor
                                .chain()
                                .insertContentAt(
                                    currentEditor.state.selection.anchor,
                                    {
                                        type: "image",
                                        attrs: {
                                            src: fileReader.result,
                                        },
                                    },
                                )
                                .focus()
                                .run();
                        };
                    }
                }
                model.value = htmlToMarkdown(editor.value.getHTML());
            },
        }),
        TaskList,
        TaskItem,
    ],
    onBlur: () => {
        model.value = htmlToMarkdown(editor.value.getHTML());
    },
    injectCSS: false,
});
const addImage = async () => {
    const url = window.prompt("URL");
    if (url) {
        if (url.startsWith("http") || url.startsWith("/")) {
            // If it's already a URL, use it directly
            editor.value.chain().focus().setImage({ src: url }).run();
        } else {
            // If it's a local file path, upload it first
            try {
                const fileInput = document.createElement("input");
                fileInput.type = "file";
                fileInput.accept = "image/*";
                fileInput.onchange = async (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (file) {
                        const response = await uploadImage(file);
                        if (response.image) {
                            editor.value
                                .chain()
                                .focus()
                                .setImage({ src: response.image })
                                .run();
                        }
                    }
                };
                fileInput.click();
            } catch (error) {
                console.error("Failed to upload image:", error);
            }
        }
    }
};

const uploadImage = async (file: File) => {
    try {
        const formData = new FormData();
        formData.append("image", file);

        const response = await $fetch("/api/upload/image", {
            method: "POST",
            body: formData,
        });

        if (!response.success) {
            throw new Error("Failed to upload image");
        }

        if (response.success && response.imageUrl) {
            return { image: response.imageUrl };
        } else {
            throw new Error("Invalid response from server");
        }
    } catch (error) {
        console.error("Image upload failed:", error);
        return { error: `Error uploading image: ${error.message}` };
    }
};

const setEmoji = (emojiCode) => {
    editor.value.chain().focus().setEmoji(emojiCode).run();
    emojiSelect.value = false;
};

// Watch for external changes to modelValue
watch(
    () => model.value,
    (value) => {
        if (!editor.value) return;

        // Compare in Markdown terms since the model is Markdown but the editor
        // holds HTML — otherwise every external set would clobber the caret.
        const isSame =
            htmlToMarkdown(editor.value.getHTML()) === (value || "");
        if (isSame) {
            return;
        }

        editor.value.commands.setContent(markdownToHtml(value));
    },
    { immediate: false },
);
</script>
