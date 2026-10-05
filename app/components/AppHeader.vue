<script setup lang="ts">
import { UsersRound, LogOut, UserRoundPen, Search } from "lucide-vue-next";

// On a board drawn as a mind map the canvas runs on behind the header. There
// the header floats above it: it is lifted over the map, and only the logo,
// the search and the nav pill take a press — the space between them lets one
// through to whatever on the map is under it. The three carry
// `pointer-events-auto` for that, which changes nothing anywhere else.
//
// It is the <header> that floats, not something wrapped around this component:
// the search dialog below is this component's too, and inside a lifted wrapper
// it was lifted no higher than the board's title, which then showed on top of
// the dialog's backdrop.
const props = defineProps({
    floating: { type: Boolean, default: false },
});

const { data: session } = await useFetch("/api/auth/get-session");
const handleLogout = async () => {
    await useFetch("/api/auth/sign-out", { method: "POST" });
    await navigateTo("/");
};

// The phone's search: a button in the nav pill, and the same search in a
// dialog. Focus is taken here rather than inside the dialog, in the click
// itself — see GlobalSearch's `focus`.
const searchOpen = ref(false);
const searchModal = ref(null);
const openSearch = () => {
    searchOpen.value = true;
    searchModal.value?.focus();
};

</script>
<template>
    <ImpersonationBanner />
    <header
        v-if="session"
        class="w-full pt-6"
        :class="{ 'relative z-20 pointer-events-none': props.floating }"
    >
        <div
            class="container mx-auto flex flex-wrap items-center justify-between gap-y-3"
        >
            <NuxtLinkLocale
                to="/dashboard/"
                class="text-primary hover:text-primary-hover cursor-pointer block pointer-events-auto"
            >
                <Logo />
            </NuxtLinkLocale>
            <!-- Search sits between the logo and the nav: a field you can type
                 in straight away, not another icon competing with the actions
                 in the pill.

                 It takes the leftover width up to the width its own placeholder
                 needs — `--search-max`, which the field measures from the text
                 actually in it. A fixed cap had to be the longest language's,
                 which left English sitting in a field half again as wide as its
                 sentence. The `28rem` is only the fallback for the moment before
                 the measurement lands.

                 Below `sm` it is gone, and the button in the pill opens it in a
                 dialog instead. It used to wrap to a full-width line under the
                 logo and the nav, which cost a phone a whole row of the screen
                 before the first board — a permanent price for something used
                 occasionally. As an icon it costs nothing until it is wanted,
                 and the dialog then gives the field and its results more room
                 than the header ever had. -->
            <GlobalSearch
                class="pointer-events-auto hidden sm:mx-8 sm:block sm:w-auto sm:min-w-0 sm:max-w-[var(--search-max,28rem)] sm:flex-1"
            />
            <ul
                class="pointer-events-auto relative flex gap-x-4 menu app-nav px-6 py-4 rounded-full bg-white dark:bg-slate"
            >
                <li class="sm:hidden">
                    <button
                        type="button"
                        @click="openSearch"
                        class="text-gray hover:text-primary-hover cursor-pointer block"
                        :aria-label="$t('headerSearch')"
                    >
                        <Search class="size-5" />
                    </button>
                </li>
                <li>
                    <NotificationBell :userID="session.data.user.id" />
                </li>
                <li v-if="session.data.user.role === 'admin'">
                    <NuxtLinkLocale
                        to="/users/"
                        class="text-gray hover:text-primary-hover cursor-pointer block"
                        v-tooltip="$t('headerUsers')"
                    >
                        <UsersRound class="size-5" />
                    </NuxtLinkLocale>
                </li>
                <li>
                    <NuxtLinkLocale
                        to="/settings/"
                        class="text-gray hover:text-primary-hover cursor-pointer block"
                        v-tooltip="$t('headerSettings')"
                    >
                        <UserRoundPen class="size-5" />
                    </NuxtLinkLocale>
                </li>
                <li>
                    <button
                        @click="handleLogout"
                        class="text-gray hover:text-primary-hover cursor-pointer block"
                        v-tooltip="$t('headerLogout')"
                    >
                        <LogOut class="size-5" />
                    </button>
                </li>
            </ul>
        </div>
    </header>

    <!-- Only ever opened below `sm`, but mounted at every width: the dialog
         animates in and out rather than mounting on demand, and the field has
         to exist already for the opening click to be able to focus it. -->
    <ModalWindow v-if="session" v-model="searchOpen">
        <h2 class="text-dark mb-4 text-2xl text-left dark:text-white">
            {{ $t("searchTitle") }}
        </h2>
        <!-- The dialog closes when the search says the navigation has landed,
             not on the click: the results stay up while the board loads. The
             header is not remounted between pages, so nothing else would close
             it. -->
        <GlobalSearch
            ref="searchModal"
            variant="modal"
            :active="searchOpen"
            @navigate="searchOpen = false"
        />
    </ModalWindow>
</template>
