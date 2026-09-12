<template>
    <!-- Laid out like the webhooks below it: the explanation belongs inside the
         box with what it explains, not floating above it. -->
    <div>
        <h2 class="text-3xl sm:text-5xl text-dark dark:text-white mt-12 mb-5">
            {{ $t("connectedApps") }}
        </h2>
        <ContentBox>
            <p class="text-gray mb-5 text-sm">{{ $t("connectedAppsIntro") }}</p>

            <ul v-if="connections.length" class="space-y-3">
                <li
                    v-for="connection in connections"
                    :key="connection.clientId"
                    class="border-gray/10 bg-light dark:bg-dark/40 flex items-center gap-3 rounded-xl border px-3 py-3 sm:px-4"
                >
                    <Plug class="text-gray size-5 shrink-0" />
                    <div class="min-w-0 grow">
                        <span
                            class="text-dark block truncate font-semibold dark:text-white"
                            >{{ connection.name }}</span
                        >
                        <span class="text-gray text-sm">
                            {{ $t("connectedAppsSince") }}
                            {{ when(connection.connectedAt) }} ·
                            {{ describe(connection.scope) }}
                        </span>
                    </div>
                    <button
                        type="button"
                        class="text-primary hover:bg-primary/10 shrink-0 rounded-lg px-3 py-1.5 text-sm"
                        @click="disconnect(connection)"
                    >
                        {{ $t("disconnect") }}
                    </button>
                </li>
            </ul>
            <p v-else class="text-gray">{{ $t("connectedAppsEmpty") }}</p>
        </ContentBox>
    </div>
</template>

<script setup lang="ts">
import { Plug } from "lucide-vue-next";

const connections = ref<any[]>([]);
const { formatServerDate } = useServerDate();

const load = async () => {
    try {
        const data: any = await $fetch("/api/oauth/connections");
        connections.value = data?.connections ?? [];
    } catch (err) {
        console.error("Could not read the connected apps:", err);
    }
};
await load();

const when = (value: string) =>
    formatServerDate(value, { day: "2-digit", month: "2-digit", year: "numeric" });

// The same two words the consent screen used, so what somebody agreed to and
// what they see here are plainly the same thing.
const describe = (scope: string) =>
    String(scope).includes("boards:write")
        ? $t("oauthGrantWrite")
        : $t("oauthGrantRead");

const disconnect = async (connection: any) => {
    try {
        await $fetch(
            `/api/oauth/connections?clientId=${encodeURIComponent(connection.clientId)}`,
            { method: "DELETE" },
        );
        connections.value = connections.value.filter(
            (entry) => entry.clientId !== connection.clientId,
        );
    } catch (err) {
        console.error("Could not disconnect this app:", err);
    }
};
</script>
