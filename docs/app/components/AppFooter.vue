<template>
  <footer role="contentinfo" class="w-full pt-8 pb-7">
    <div class="container text-gray">
      <div class="bg-slate rounded-3xl px-8 pt-10 sm:px-12 sm:pt-14 pb-7">
        <!-- The brand column is wider than the link columns because it holds a
             paragraph rather than a list. Below `lg` the four become two, and
             on a phone one — link lists stack better than they wrap. -->
        <div
          class="grid gap-10 grid-cols-1 xs:grid-cols-2 sm:grid-cols-3 lg:grid-cols-[1.6fr_1fr_1fr_1fr] lg:gap-12"
        >
          <div class="col-span-1 xs:col-span-2 sm:col-span-3 lg:col-span-1">
            <NuxtLink
              to="/"
              aria-label="LokalBoards"
              class="text-primary hover:text-primary-hover flex items-center gap-3"
            >
              <Logo class="w-10" />
              <span class="text-dark text-lg font-medium">LokalBoards</span>
            </NuxtLink>

            <p class="mt-5 max-w-sm">
              Kanban boards that run on your own server. Open source under the
              MIT licence, written in Germany, and yours to host wherever you
              decide to put it.
            </p>

            <NuxtLink
              to="/docs/"
              class="bg-primary hover:bg-primary-hover mt-6 inline-block rounded-full px-6 py-3 text-white transition-colors"
              >Getting started</NuxtLink
            >
          </div>

          <div v-for="column in columns" :key="column.title">
            <p class="text-dark mb-4 font-medium">{{ column.title }}</p>
            <ul class="space-y-2.25">
              <li v-for="link in column.links" :key="link.label">
                <a
                  v-if="link.href"
                  :href="link.href"
                  :target="link.href.startsWith('http') ? '_blank' : undefined"
                  :rel="link.href.startsWith('http') ? 'noopener' : undefined"
                  class="hover:text-primary"
                  >{{ link.label }}</a
                >
                <NuxtLink v-else :to="link.to" class="hover:text-primary">{{
                  link.label
                }}</NuxtLink>
              </li>
            </ul>
          </div>
        </div>

        <!-- Who made it on the left, the legal pages on the right — the same
             line the Chesstics site ends on. -->
        <div
          class="border-gray/15 mt-12 flex flex-wrap justify-between gap-x-6 gap-y-2 border-t pt-6"
        >
          <p>
            © {{ year }}
            <a
              href="https://www.florian-strasser.de"
              target="_blank"
              rel="noopener"
              class="hover:text-primary"
              >Florian Strasser</a
            >
          </p>
          <ul class="flex flex-wrap gap-x-6 gap-y-2" aria-label="Legal">
            <li v-for="link in legal" :key="link.to">
              <NuxtLink :to="link.to" class="hover:text-primary">{{
                link.label
              }}</NuxtLink>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
// Everything the footer links to, in the three groups it shows them in, and the
// legal pages on the line underneath. A link is either internal (`to`) or
// external (`href`); nothing here is a route that does not exist.
const columns = [
  {
    title: "Menu",
    links: [
      { label: "About", to: "/#about" },
      { label: "Features", to: "/#features" },
      { label: "Pricing", to: "/#pricing" },
      { label: "FAQ", to: "/#faq" },
    ],
  },
  {
    title: "Navigation",
    links: [
      { label: "Documentation", to: "/docs" },
      { label: "API reference", to: "/api" },
      { label: "Changelog", to: "/changelog" },
      { label: "Source code", href: "https://github.com/florian-strasser/LokalBoards" },
    ],
  },
  {
    title: "Other apps",
    links: [
      { label: "LokalTransfer", href: "https://lokaltransfer.com" },
      { label: "Chesstics", href: "https://chesstics.app" },
    ],
  },
];

const legal = [
  { label: "Privacy policy", to: "/privacy-policy" },
  { label: "Site notice", to: "/site-notice" },
];

const year = new Date().getFullYear();
</script>
