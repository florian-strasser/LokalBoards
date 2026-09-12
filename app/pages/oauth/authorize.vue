<template>
    <div class="relative min-h-svh flex flex-col">
        <main class="flex grow shrink-0 flex-col justify-center py-8">
            <div class="container mx-auto">
                <div class="mx-auto max-w-lg">
                    <div class="mb-6 flex justify-center">
                        <Logo />
                    </div>
                    <div
                        class="bg-white dark:bg-slate rounded-lg p-8 text-center"
                    >
                        <p v-if="pending" class="text-gray">…</p>

                        <!-- Something is wrong with the request itself. Shown
                             here rather than sent onwards: until the client and
                             its redirect are both known-good, bouncing the
                             browser to an address the request supplied is how an
                             open redirector is built. -->
                        <template v-else-if="failure">
                            <h1 class="text-dark mb-3 text-3xl dark:text-white">
                                {{ $t("oauthRefusedTitle") }}
                            </h1>
                            <p class="mb-6">{{ failure }}</p>
                            <a
                                v-if="failureRedirect"
                                :href="failureRedirect"
                                class="bg-primary hover:bg-primary-hover inline-block rounded-lg px-6 py-3 text-white"
                                >{{ $t("oauthBackToApp") }}</a
                            >
                            <NuxtLink
                                v-else
                                to="/dashboard/"
                                class="text-primary hover:text-primary-hover"
                                >{{ $t("toDashboard") }}</NuxtLink
                            >
                        </template>

                        <template v-else-if="request">
                            <h1 class="text-dark mb-3 text-3xl dark:text-white">
                                {{ $t("oauthConnectTitle") }}
                            </h1>
                            <p class="mb-6">
                                <strong class="text-dark dark:text-white">{{
                                    request.client.name
                                }}</strong>
                                {{ $t("oauthConnectIntro") }}
                            </p>

                            <ul class="mb-6 space-y-2 text-left">
                                <li class="flex items-start gap-2">
                                    <Check
                                        class="text-primary mt-0.5 size-5 shrink-0"
                                    />
                                    <span>{{ $t("oauthGrantRead") }}</span>
                                </li>
                                <li
                                    v-if="!readOnly"
                                    class="flex items-start gap-2"
                                >
                                    <Check
                                        class="text-primary mt-0.5 size-5 shrink-0"
                                    />
                                    <span>{{ $t("oauthGrantWrite") }}</span>
                                </li>
                            </ul>

                            <!-- The same read-only choice an API key offers.
                                 A connector cannot ask for less than it wants,
                                 so the person being asked is where the choice
                                 belongs. -->
                            <div v-if="request.writes" class="mb-6 text-left">
                                <InputCheckbox
                                    v-model="readOnly"
                                    :label="$t('oauthReadOnlyOption')"
                                />
                            </div>

                            <p class="text-gray mb-6 text-sm">
                                {{ $t("oauthActingAs") }}
                                <strong class="text-dark dark:text-white">{{
                                    request.account?.name
                                }}</strong>
                            </p>

                            <div class="flex gap-2">
                                <button
                                    type="button"
                                    :disabled="deciding"
                                    class="bg-primary hover:bg-primary-hover disabled:opacity-60 grow rounded-lg px-6 py-3 text-white"
                                    @click="decide(true)"
                                >
                                    {{ $t("oauthAllow") }}
                                </button>
                                <button
                                    type="button"
                                    :disabled="deciding"
                                    class="bg-dark/5 dark:bg-white/10 text-dark rounded-lg px-6 py-3 dark:text-white"
                                    @click="decide(false)"
                                >
                                    {{ $t("oauthDeny") }}
                                </button>
                            </div>
                        </template>
                    </div>
                </div>
            </div>
        </main>
    </div>
</template>

<script setup lang="ts">
import { Check } from "lucide-vue-next";

// The consent screen. Everything it shows comes from the server, which has
// already decided whether the request is one it is willing to act on.
definePageMeta({ layout: false });

const route = useRoute();
const pending = ref(true);
const deciding = ref(false);
const request = ref<any>(null);
const failure = ref<string | null>(null);
const failureRedirect = ref<string | null>(null);
const readOnly = ref(false);

const params = () => ({ ...route.query });

onMounted(async () => {
    try {
        const data: any = await $fetch("/api/oauth/authorize", {
            query: params(),
        });
        request.value = data;
        // A client that did not ask to write does not get the option to: the
        // choice can only narrow what was requested, never widen it.
        readOnly.value = !data.writes;
        // Not signed in: go and sign in, then come back to exactly this
        // request. `safeRedirect` on the way back only accepts a path on this
        // instance, so the round trip cannot be used to bounce somebody off it.
        if (!data.account) {
            return navigateTo(
                `/?redirect=${encodeURIComponent(route.fullPath)}`,
            );
        }
    } catch (error: any) {
        const data = error?.data ?? {};
        failure.value =
            data.error_description || "This request could not be completed.";
        failureRedirect.value = data.redirect ?? null;
    } finally {
        pending.value = false;
    }
});

const decide = async (approve: boolean) => {
    deciding.value = true;
    try {
        const data: any = await $fetch("/api/oauth/authorize", {
            method: "POST",
            // The request goes back exactly as it arrived, plus the one
            // decision made here. The server works out what was granted from
            // the two, so this page cannot hand out more than was asked for.
            body: { ...params(), readOnly: readOnly.value, approve },
        });
        if (data?.redirect) window.location.href = data.redirect;
    } catch (error: any) {
        failure.value =
            error?.data?.error_description ||
            "This request could not be completed.";
    } finally {
        deciding.value = false;
    }
};
</script>
