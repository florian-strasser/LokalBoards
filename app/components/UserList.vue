<template>
    <div>
        <!-- Search + sort controls. Search filters by name or email; sort orders
             by name or account age. Both act on the already-fetched list. -->
        <div class="mb-5 flex flex-col gap-3 sm:flex-row">
            <div class="relative grow">
                <Search
                    class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray"
                />
                <!-- Marked as a custom combobox with password-manager / autofill
                     opt-outs so Safari doesn't overlay saved e-mail suggestions
                     (including the admin's own address) on top of the field. -->
                <input
                    v-model="search"
                    type="text"
                    :placeholder="$t('searchUsers')"
                    class="form-control !pl-9"
                    name="lb-user-search"
                    role="combobox"
                    aria-autocomplete="list"
                    :aria-expanded="showList && suggestions.length > 0"
                    autocomplete="off"
                    autocorrect="off"
                    autocapitalize="off"
                    spellcheck="false"
                    data-1p-ignore
                    data-lpignore="true"
                    data-form-type="other"
                    @focus="showList = true"
                    @input="showList = true"
                    @blur="onBlur"
                />
                <!-- Typeahead suggestions (avatar + name + email), matched
                     client-side against the already-loaded list. Picking one
                     fills the search with that user's name, narrowing the list
                     below to them. -->
                <ul
                    v-if="showList && suggestions.length > 0"
                    class="absolute inset-x-0 z-50 mt-1 max-h-60 overflow-auto rounded-xl border border-gray/20 bg-white p-1 shadow-xl dark:border-white/15 dark:bg-slate"
                >
                    <li v-for="u in suggestions" :key="u.id">
                        <button
                            type="button"
                            @mousedown.prevent="pickUser(u)"
                            class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-dark hover:bg-primary/10 dark:text-white dark:hover:bg-white/10"
                        >
                            <span
                                class="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-xs text-white"
                            >
                                <img
                                    v-if="u.image"
                                    :src="u.image"
                                    class="h-full w-full object-cover"
                                />
                                <template v-else>{{
                                    (u.username || "?").charAt(0).toUpperCase()
                                }}</template>
                            </span>
                            <span class="min-w-0 grow text-left">
                                <span class="block truncate">{{
                                    u.username
                                }}</span>
                                <span class="block truncate text-xs text-gray">{{
                                    u.email
                                }}</span>
                            </span>
                        </button>
                    </li>
                </ul>
            </div>
            <SelectMenu
                v-model="sort"
                class="shrink-0 sm:w-56"
                :options="[
                    { value: 'newest', label: $t('sortNewest') },
                    { value: 'oldest', label: $t('sortOldest') },
                    { value: 'name_asc', label: $t('sortNameAsc') },
                    { value: 'name_desc', label: $t('sortNameDesc') },
                ]"
            />
        </div>

        <ul v-if="displayedUsers.length > 0" class="space-y-3">
            <li v-for="item in displayedUsers" :key="item.id">
                <UserListItem
                    :id="item.id"
                    :name="item.username"
                    :email="item.email"
                    :image="item.image"
                    :role="item.role"
                    :type="item.type"
                    :is-self="item.id === currentUserId"
                    v-model="deleteModal"
                />
            </li>
        </ul>
        <p v-else class="py-6 text-center text-gray">
            {{ $t("noUsersFound") }}
        </p>

        <ModalWindow v-model="deleteModal">
            <h2 class="text-4xl text-dark dark:text-white mb-6">
                {{ $t("deleteUserMessage") }}
            </h2>
            <label class="block text-left text-sm font-medium text-gray mb-1">
                {{ $t("deleteUserReason") }}
            </label>
            <textarea
                v-model="deleteReason"
                rows="3"
                :placeholder="$t('deleteUserReasonPlaceholder')"
                class="form-control mb-4 resize-none text-left"
            />
            <button
                @click="deleteUser"
                type="button"
                :disabled="deleteReason.trim() === ''"
                class="button bg-primary hover:bg-primary-hover w-full text-center px-6 py-3 rounded-lg text-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-primary"
            >
                {{ $t("deleteUser") }}
            </button>
        </ModalWindow>
    </div>
</template>
<script setup lang="ts">
import { Search } from "@lucide/vue";

const nuxtApp = useNuxtApp();

const deleteModal = ref(false);
const deleteReason = ref("");
const userList = ref([]);

const search = ref("");
const sort = ref("newest");
const showList = ref(false);

// Clear the reason whenever the modal closes (delete, cancel or backdrop).
watch(deleteModal, (open) => {
    if (!open) deleteReason.value = "";
});

const { data: session } = await useFetch("/api/auth/get-session");
const currentUserId = session.value?.data?.user?.id;

const { data: users } = await useFetch("/api/auth/admin/list");
if (users?.value?.users) {
    userList.value = users.value.users;
}

// Typeahead suggestions for the search field: the same name/email match used
// for the list, capped to a handful and only while there's a query. Picking one
// fills the search box (which then narrows the list below to that user).
const suggestions = computed(() => {
    const query = search.value.trim().toLowerCase();
    if (!query) return [];
    return userList.value
        .filter(
            (u) =>
                (u.username || "").toLowerCase().includes(query) ||
                (u.email || "").toLowerCase().includes(query),
        )
        .slice(0, 8);
});

const pickUser = (user) => {
    search.value = user.username || "";
    showList.value = false;
};

// Close a beat after blur so a click on a suggestion still registers.
const onBlur = () => {
    setTimeout(() => (showList.value = false), 120);
};

const displayedUsers = computed(() => {
    const query = search.value.trim().toLowerCase();
    let list = userList.value.filter((u) => {
        if (!query) return true;
        return (
            (u.username || "").toLowerCase().includes(query) ||
            (u.email || "").toLowerCase().includes(query)
        );
    });

    const byName = (a, b) =>
        (a.username || "").localeCompare(b.username || "", undefined, {
            sensitivity: "base",
        });
    const byCreated = (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

    switch (sort.value) {
        case "name_asc":
            list.sort(byName);
            break;
        case "name_desc":
            list.sort((a, b) => byName(b, a));
            break;
        case "oldest":
            list.sort(byCreated);
            break;
        case "newest":
        default:
            list.sort((a, b) => byCreated(b, a));
            break;
    }
    return list;
});

const deleteUser = async () => {
    try {
        const response = await $fetch("/api/auth/admin/delete", {
            method: "POST",
            body: {
                userId: deleteModal.value,
                reason: deleteReason.value,
            },
        });

        if (response.success) {
            // Remove the deleted user from the list
            userList.value = userList.value.filter(
                (user) => user.id !== deleteModal.value,
            );
            await nuxtApp.callHook("app:toast", {
                message: $t("userDeleted"),
            });
        } else {
            throw new Error(response.error || "Failed to delete user");
        }
    } catch (e) {
        let errorMessage = "Failed to delete user";
        if (e?.data?.error) {
            errorMessage = e.data.error;
        } else if (e?.message) {
            errorMessage = e.message;
        }

        await nuxtApp.callHook("app:toast", {
            message: errorMessage,
        });
    }

    deleteModal.value = false;
    setBodyScrollLock(false);
};
</script>
