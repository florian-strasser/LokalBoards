<template>
    <div>
        <ContentBox>
            <form
                v-if="!createdUser"
                @submit.prevent="handleNewUser"
                class="space-y-6"
            >
                <div class="form-group">
                    <InputField
                        type="text"
                        name="name"
                        :label="$t('name')"
                        :required="true"
                        v-model="name"
                    />
                </div>

                <div class="form-group">
                    <InputField
                        type="email"
                        name="email"
                        :label="$t('email')"
                        :required="true"
                        v-model="email"
                    />
                </div>

                <div class="form-group">
                    <div class="flex gap-x-4 items-end">
                        <InputField
                            type="text"
                            :label="$t('password')"
                            name="password"
                            :required="true"
                            v-model="password"
                        />
                        <button
                            type="button"
                            class="bg-primary text-white hover:bg-primary-hover px-4 h-11 rounded-lg"
                            v-tooltip="$t('generatePassword')"
                            @click="password = generateRandomPassword()"
                        >
                            <Zap class="size-6" />
                        </button>
                    </div>
                </div>

                <div class="form-group">
                    <label class="mb-1 block text-sm/6 font-medium text-gray">{{
                        $t("role")
                    }}</label>
                    <SegmentedControl
                        :values="[
                            { value: 'user', label: $t('user') },
                            { value: 'admin', label: $t('admin') },
                        ]"
                        name="role"
                        v-model="role"
                    />
                </div>

                <div class="form-group">
                    <label class="mb-1 block text-sm/6 font-medium text-gray">{{
                        $t("userType")
                    }}</label>
                    <SegmentedControl
                        :values="[
                            { value: 'human', label: $t('userTypeHuman') },
                            {
                                value: 'artificial',
                                label: $t('userTypeArtificial'),
                            },
                        ]"
                        name="type"
                        v-model="type"
                    />
                    <p class="mt-1 text-xs text-gray">
                        {{ $t("userTypeHint") }}
                    </p>
                </div>

                <div class="form-group">
                    <InputCheckbox
                        v-model="sendWelcomeEmail"
                        :label="$t('sendCredentialsByEmail')"
                    />
                </div>

                <div class="form-group">
                    <InputCheckbox
                        v-model="showOnboarding"
                        :label="$t('showOnboardingToUser')"
                    />
                </div>

                <input
                    type="submit"
                    class="button bg-primary hover:bg-primary-hover w-full text-center px-6 py-3 rounded-lg text-white"
                    :value="$t('createAccount')"
                />
            </form>
            <div v-else class="space-y-5">
                <p v-if="emailSent">
                    {{ $t("accountCreatedEmailSent", { email }) }}
                </p>
                <template v-else>
                    <p v-if="emailRequested" class="text-primary">
                        {{ $t("accountCreatedEmailFailed") }}
                    </p>
                    <p>
                        {{ $t("accountCreatedMessage") }}
                    </p>
                    <p>
                        {{ $t("email") }}: {{ email }}<br />
                        {{ $t("password") }}: {{ password }}
                    </p>
                </template>
            </div>
        </ContentBox>
    </div>
</template>
<script setup lang="ts">
import { Zap } from "@lucide/vue";

const nuxtApp = useNuxtApp();

const generateRandomPassword = () => {
    const chars =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+";
    let result = "";
    for (let i = 0; i < 12; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

const name = ref("");
const email = ref("");
const password = ref(generateRandomPassword());
const role = ref("user");
const type = ref("human");
// Off by default so existing behaviour (admin copies the credentials) is
// unchanged; when on, the new user is emailed their login details.
const sendWelcomeEmail = ref(false);
// Off by default: admin-created accounts are usually managed (the admin owns
// the boards), so the first-run tour would be out of place. Tick to enable it.
const showOnboarding = ref(false);

const createdUser = ref(false);
const emailRequested = ref(false);
const emailSent = ref(false);

const handleNewUser = async () => {
    try {
        emailRequested.value = sendWelcomeEmail.value;
        const response = await $fetch("/api/auth/admin/create", {
            method: "POST",
            body: {
                name: name.value,
                email: email.value,
                password: password.value,
                role: role.value,
                type: type.value,
                sendEmail: sendWelcomeEmail.value,
                onboarding: showOnboarding.value,
            },
        });

        if (response.success) {
            emailSent.value = !!response.emailSent;
            createdUser.value = true;
            await nuxtApp.callHook("app:toast", {
                message:
                    emailRequested.value && !emailSent.value
                        ? $t("accountCreatedEmailFailed")
                        : $t("userCreated"),
            });
        } else {
            throw new Error(response.error || "Failed to create user");
        }
    } catch (e) {
        let errorMessage = "Failed to create user";
        if (e?.data?.error) {
            errorMessage = e.data.error;
        } else if (e?.message) {
            errorMessage = e.message;
        }

        await nuxtApp.callHook("app:toast", {
            message: errorMessage,
        });
    }
};
</script>
