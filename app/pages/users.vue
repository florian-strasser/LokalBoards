<template>
    <div class="min-h-svh flex flex-col justify-between">
        <AppHeader />
        <ContentWrapper>
            <SectionHeader url="/new-user/" :tooltip="$t('newUser')">
                {{ $t("users") }}
                <!-- The whole instance in one download: every board as JSON
                     with its files, and the database as SQL. Here because it
                     is an administrator's job, and this is their page. -->
                <template #actions>
                    <ActionMenu :tooltip="$t('moreOptions')">
                        <button
                            type="button"
                            @click="startDownload('/api/data/export')"
                            class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-dark hover:bg-primary/10 hover:text-primary dark:text-white"
                        >
                            <DatabaseBackup class="size-4 shrink-0" />
                            {{ $t("exportAllData") }}
                        </button>
                    </ActionMenu>
                </template>
            </SectionHeader>
            <ContentBox>
                <UserList />
            </ContentBox>
        </ContentWrapper>
    </div>
</template>
<script setup lang="ts">
import { DatabaseBackup } from "lucide-vue-next";

useHead({
    title: $t("users"),
});
</script>
