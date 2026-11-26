<template>
    <div class="app-wrapper">
        <NuxtRouteAnnouncer />
        <NuxtPage />
        <ToastHolder />
        <OnboardingOverlay />
    </div>
</template>
<script setup lang="ts">
const nuxtApp = useNuxtApp();
const config = nuxtApp.$config.public;

// The app name lives in the (server-only) runtimeConfig so it can be set via
// NUXT_APP_NAME at runtime. useState carries the resolved value to the client
// so the title is correct both during SSR and on client-side navigation.
const appName = useState(
    "appName",
    () => useRuntimeConfig().appName || "LokalBoards",
);

// Same runtime story as the app name: the language comes from NUXT_LANGUAGE and
// is shared with the i18n plugin via the "language" state key.
const language = useState(
    "language",
    () => useRuntimeConfig().language || "en",
);

// The instance's colours, over the defaults in main.css. A setting that is not
// a colour is left out, and the default stays (see `cssColour`).
const colours = (values: Record<string, unknown>) =>
    Object.entries(values)
        .map(([name, value]) => [name, cssColour(value)])
        .filter(([, value]) => value)
        .map(([name, value]) => `--color-${name}: ${value};`)
        .join("\n");

useHead({
    htmlAttrs: {
        lang: language.value,
    },
    // Only define the template. Pages set their own title chunk (e.g. a board
    // name) which becomes "<chunk> | <appName>"; pages without a title fall
    // back to just "<appName>". No static title is set here or in the config,
    // otherwise it would be wrapped into "<appName> | <appName>".
    titleTemplate: (titleChunk) =>
        titleChunk ? `${titleChunk} | ${appName.value}` : appName.value,
    style: [
        {
            innerHTML: `
              :root {
                ${colours({
                    primary: config.colorPrimary,
                    "primary-hover": config.colorPrimaryHover,
                    white: config.colorWhite,
                    gray: config.colorGray,
                    slate: config.colorSlate,
                    black: config.colorBlack,
                    dark: config.colorDark,
                })}
              }
              @media (prefers-color-scheme: dark) {
                :root {
                  ${colours({
                      primary: config.colorPrimaryDark,
                      "primary-hover": config.colorPrimaryHoverDark,
                      gray: config.colorGrayDark,
                      slate: config.colorSlateDark,
                      dark: config.colorDarkDark,
                  })}
                }
              }
            `,
            type: "text/css",
        },
    ],
});
</script>
