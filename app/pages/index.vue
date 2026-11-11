<template>
    <div class="relative min-h-svh flex flex-col">
        <main class="flex flex-col justify-center py-8 grow shrink-0">
            <div class="container mx-auto">
                <div class="max-w-lg mx-auto">
                    <div class="grid grid-cols-2 text-sm relative">
                        <div
                            class="text-center block py-3 px-5 bg-white dark:bg-slate dark:text-white rounded-t-lg"
                        >
                            {{ $t("login") }}
                        </div>
                        <div class="bg-white dark:bg-slate">
                            <NuxtLink
                                v-if="allowSignup"
                                to="/sign-up/"
                                class="text-primary dark:text-white hover:text-primary-hover text-center block py-3 px-5 rounded-bl-lg bg-slate dark:bg-dark"
                            >
                                {{ $t("signUp") }}
                            </NuxtLink>
                            <div
                                v-else
                                class="relative min-h-full rounded-bl-lg bg-slate dark:bg-dark"
                            />
                        </div>
                    </div>
                    <div
                        class="bg-white dark:bg-slate rounded-lg rounded-tl-none p-5"
                    >
                        <form
                            @submit.prevent="handleLogin"
                            class="relative space-y-4"
                        >
                            <InputField
                                type="email"
                                :label="$t('email')"
                                required
                                v-model="email"
                            />
                            <InputField
                                type="password"
                                :label="$t('password')"
                                required
                                v-model="password"
                            />
                            <input
                                type="submit"
                                class="block w-full rounded-lg px-4 py-2 bg-primary hover:bg-primary-hover text-white"
                                :value="$t('loginBtn')"
                            />
                        </form>
                    </div>
                    <!-- Single sign-on, when the instance is set up for it.
                         Below the form rather than above it: an instance can
                         have both, and the people who use the password form are
                         the ones who have no other way in. -->
                    <div v-if="anySso" class="mt-4">
                        <div class="mb-4 flex items-center gap-3 text-xs text-gray">
                            <span class="h-px grow bg-gray/20" />
                            {{ $t("or") }}
                            <span class="h-px grow bg-gray/20" />
                        </div>
                        <!-- A plain link, not a fetch: the provider answers with
                             a redirect to its own sign-in page, and the browser
                             has to follow it. -->
                        <div class="space-y-2">
                            <!-- The one that matches the address being typed,
                                 first and filled in: with several providers the
                                 right one is the only one that matters, and
                                 nobody should have to know which of their
                                 organisation's names is on it. -->
                            <a
                                v-if="routed"
                                :href="routed.start"
                                class="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-white hover:bg-primary-hover"
                            >
                                <KeyRound class="size-4 shrink-0" />
                                {{ routed.label }}
                            </a>
                            <a
                                v-for="provider in providers"
                                :key="provider.id"
                                v-show="!routed || routed.id !== provider.id"
                                :href="provider.start"
                                class="flex w-full items-center justify-center gap-2 rounded-lg border border-gray/25 px-4 py-2 text-dark hover:border-primary hover:text-primary dark:text-white"
                            >
                                <KeyRound class="size-4 shrink-0" />
                                {{ provider.label }}
                            </a>
                        </div>
                    </div>
                    <div class="text-center mt-4 text-sm">
                        <NuxtLink
                            class="text-primary dark:text-gray hover:text-primary-hover"
                            to="/lost-password/"
                        >
                            {{ $t("lostPasswordQuestion") }}
                        </NuxtLink>
                    </div>
                </div>
            </div>
        </main>
    </div>
</template>
<script setup lang="ts">
import { safeRedirect } from "@/utils/redirectTarget";
import * as z from "zod";
import { KeyRound } from "@lucide/vue";

const nuxtApp = useNuxtApp();
const allowSignup =
    nuxtApp.$config.public.signup === true
        ? true
        : nuxtApp.$config.public.signup === "true"
          ? true
          : false;

// Whether this instance has single sign-on, asked of the server so the button
// renders with the page rather than appearing a moment later.
const { data: sso } = await useFetch("/api/auth/sso/config");
const providers = computed(() => sso.value?.providers ?? []);
const anySso = computed(() => providers.value.length > 0);


// The SSO endpoints have nowhere to report to but this page: they are visited
// by a redirect, not by a fetch, so a failure comes back as a query parameter
// and is shown here like any other sign-in failure.
const route = useRoute();
onMounted(async () => {
    const reason = String(route.query.sso_error || "");
    if (!reason) return;
    await nuxtApp.callHook("app:toast", { message: $t("sso_" + reason) });
    // Cleared from the URL, so a reload does not repeat it.
    await navigateTo("/", { replace: true });
});

useHead({
    title: $t("login"),
});

const schema = z.object({
    email: z.email("Invalid e-mail address"),
    password: z.string("Password required"),
});

const email = ref("");
const password = ref("");

// Where several providers are configured and each says which e-mail domains it
// signs in, typing an address offers the right one. The lookup runs against the
// address as it is typed, debounced, and says nothing about whether an account
// exists — only which provider handles that domain.
const routed = ref<any | null>(null);
let routeTimer: ReturnType<typeof setTimeout> | undefined;

watch(email, (value) => {
    if (!sso.value?.routing) return;
    clearTimeout(routeTimer);
    routed.value = null;
    if (!value.includes("@")) return;
    routeTimer = setTimeout(async () => {
        try {
            const answer: any = await $fetch("/api/auth/sso/route", {
                query: { email: value },
            });
            routed.value = answer?.provider ?? null;
        } catch {
            routed.value = null;
        }
    }, 400);
});

onBeforeUnmount(() => clearTimeout(routeTimer));

type Schema = z.output<typeof schema>;

const handleLogin = async () => {
    const formData = { email: email.value, password: password.value };

    try {
        // Validate the form data
        schema.parse(formData);

        // Where the middleware said this person was heading before they were
        // asked to sign in. Checked here rather than trusted: it arrived in the
        // address bar, where anybody can put anything.
        const destination = safeRedirect(route.query.redirect);

        const { data, error } = await $fetch(`/api/auth/sign-in`, {
            method: "POST",
            body: {
                email: email.value,
                password: password.value,
                callbackURL: destination,
            },
        });
        if (data.callbackURL) {
            // Checked again on the way back: what the server returns is what
            // was sent, and there is no reason to relax about it twice.
            navigateTo(safeRedirect(data.callbackURL));
        }
    } catch (e) {
        // Handle validation errors
        if (e instanceof z.ZodError) {
            const errors = await JSON.parse(e);
            await nuxtApp.callHook("app:toast", {
                message: $t("error_" + errors[0].code),
            });
            // You can display these errors to the user
        } else {
            // Extract error message from fetch response
            let errorMessage = "Login failed";

            if (e?.data?.error) {
                errorMessage = $t("error_" + e.data.error);
            } else if (e?.message) {
                errorMessage = e.message;
            }

            await nuxtApp.callHook("app:toast", {
                message: errorMessage,
            });
        }
    }
};
</script>
