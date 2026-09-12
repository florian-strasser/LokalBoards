<template>
    <!-- Everything this board (or this account) has put away, and the two things
         you can do with it. The permanent delete lives here and nowhere else:
         it is the one action in the app that cannot be taken back, so it should
         take a deliberate visit to find. -->
    <ModalWindow v-model="isOpen">
        <h2 class="text-dark mb-6 text-4xl dark:text-white">
            {{ $t("archive") }}
        </h2>

        <p v-if="loading" class="text-gray">…</p>
        <p v-else-if="!anything" class="text-gray">{{ $t("archiveEmpty") }}</p>

        <!-- Said plainly, because the archive empties itself: somebody deciding
             whether it is safe to archive a column should not have to find that
             out a month later. -->
        <p v-if="!loading && retention > 0" class="text-gray mb-6 text-sm">
            {{ $t("archiveRetentionNotice", { days: retention }) }}
        </p>

        <section
            v-for="group in groups"
            :key="group.type"
            class="mb-6 last:mb-0"
        >
            <h3
                class="text-gray mb-2 text-xs font-bold tracking-wide uppercase"
            >
                {{ $t(group.heading) }}
            </h3>
            <ul class="space-y-2">
                <li
                    v-for="row in group.rows"
                    :key="row.id"
                    class="bg-dark/5 flex items-center gap-3 rounded-lg p-3 dark:bg-white/10"
                >
                    <span class="min-w-0 grow text-left">
                        <span class="text-dark block truncate dark:text-white">{{
                            row.name
                        }}</span>
                        <span
                            class="text-gray flex items-center gap-1 text-xs"
                        >
                            <!-- How many cards went with a column, said with
                                 the icon rather than the word: "1 cards" is
                                 wrong in every language that has a plural. -->
                            <template v-if="group.type === 'area'">
                                <Layers class="size-3 shrink-0" />
                                {{ row.cardCount ?? 0 }}
                                <span aria-hidden="true">·</span>
                            </template>
                            <template v-else-if="row.areaName">
                                {{ row.areaName }}
                                <span aria-hidden="true">·</span>
                            </template>
                            {{ when(row.archivedAt) }}
                        </span>
                    </span>
                    <button
                        type="button"
                        class="bg-primary hover:bg-primary-hover shrink-0 rounded-lg px-3 py-1.5 text-sm text-white"
                        @click="restore(group.type, row)"
                    >
                        {{ $t("restore") }}
                    </button>
                    <button
                        type="button"
                        class="text-gray hover:text-primary shrink-0 rounded-lg p-1.5"
                        :aria-label="$t('deletePermanently')"
                        v-tooltip="$t('deletePermanently')"
                        @click="askPurge(group.type, row)"
                    >
                        <Trash2 class="size-4" />
                    </button>
                </li>
            </ul>
        </section>
    </ModalWindow>

    <DeleteConfirmationModal
        v-model="purgeOpen"
        :title="$t('deletePermanentlyTitle')"
        :message="$t('deletePermanentlyText')"
        :confirmButtonText="$t('deletePermanently')"
        :onConfirm="purge"
    />
</template>

<script setup lang="ts">
import { Layers, Trash2 } from "lucide-vue-next";

const props = defineProps({
    // A board's archive holds its areas and its cards. Without one, this is the
    // dashboard's archive and holds whole boards.
    boardID: { type: Number, default: null },
});

const isOpen = defineModel<boolean>({ default: false });
// Something came back; whoever opened this should re-read what it is showing.
const emit = defineEmits(["restored"]);

const { formatServerDate } = useServerDate();

const loading = ref(false);
const areas = ref<any[]>([]);
const cards = ref<any[]>([]);
const boards = ref<any[]>([]);
const retention = ref(0);

const groups = computed(() =>
    [
        { type: "board", heading: "boards", rows: boards.value },
        { type: "area", heading: "areas", rows: areas.value },
        { type: "card", heading: "cards", rows: cards.value },
    ].filter((group) => group.rows.length > 0),
);
const anything = computed(() => groups.value.length > 0);

const load = async () => {
    loading.value = true;
    try {
        const data: any = await $fetch("/api/data/archive", {
            query: props.boardID ? { boardId: props.boardID } : undefined,
        });
        areas.value = data?.areas ?? [];
        cards.value = data?.cards ?? [];
        boards.value = data?.boards ?? [];
        retention.value = Number(data?.retentionDays ?? 0);
    } catch (err) {
        console.error("Could not read the archive:", err);
    } finally {
        loading.value = false;
    }
};

watch(isOpen, (open) => {
    if (open) load();
});

const when = (value: string) =>
    formatServerDate(value, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });

const drop = (type: string, id: number) => {
    const list = type === "card" ? cards : type === "area" ? areas : boards;
    list.value = list.value.filter((row: any) => row.id !== id);
};

const restore = async (type: string, row: any) => {
    try {
        await $fetch("/api/data/archive", {
            method: "POST",
            body: { type, id: row.id },
        });
        drop(type, row.id);
        emit("restored");
    } catch (err) {
        console.error("Could not restore this:", err);
    }
};

// Held between asking and confirming, so the confirmation dialog does not need
// to know what it is confirming.
const purgeOpen = ref(false);
const pending = ref<{ type: string; row: any } | null>(null);
const askPurge = (type: string, row: any) => {
    pending.value = { type, row };
    purgeOpen.value = true;
};

const purge = async () => {
    const target = pending.value;
    if (!target) return;
    const { type, row } = target;
    try {
        // The permanent delete is the one each thing's own endpoint already
        // knew how to do — including taking a card's uploaded files with it —
        // so it is asked for there rather than reimplemented here.
        if (type === "card") {
            await $fetch("/api/data/card", {
                method: "DELETE",
                body: { cardID: row.id, permanent: true },
            });
        } else if (type === "area") {
            await $fetch(
                `/api/data/area?id=${row.id}&boardId=${props.boardID}&permanent=true`,
                { method: "DELETE" },
            );
        } else {
            await $fetch(`/api/data/board?id=${row.id}&permanent=true`, {
                method: "DELETE",
            });
        }
        drop(type, row.id);
    } catch (err) {
        console.error("Could not delete this permanently:", err);
    } finally {
        pending.value = null;
        purgeOpen.value = false;
    }
};
</script>
