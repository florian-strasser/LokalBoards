<template>
  <!-- Every page renders its own header and says how it should look, rather
       than the header working the current route out for itself.

       In the flow, on every page, in every state. There was an `absolute` mode
       that took it out of the flow; no page ever asked for it, and a header
       that leaves the flow on one route and not the next moves the page's top
       edge between them — the jump this component was written to fix. The same
       is true while the menu is open: pinning the whole row put the logo over
       the scrolling list, with entries sliding underneath it. Only the button
       that opens and closes the menu is pinned — see it below — because it is
       the one thing that has to stay reachable however far the list has been
       scrolled. -->
  <header class="absolute top-0 left-0 z-20 w-full py-6" role="banner">
    <!-- The sheet the small-screen menu opens into.

         The scrolling panel covers the whole viewport (top padding keeps the
         first entry clear of the close button) rather than starting beneath the
         header. `w-screen` rather than `inset-0`, because a fixed element's
         right edge stops at the content edge — inside the gutter the page has
         reserved — which drew the panel's scrollbar with an empty channel to
         the right of it. A hundred viewport-widths reaches the window edge, so
         the one visible bar sits exactly where the page's would be. On a touch
         device there is no gutter and the two are the same thing. `data-lenis-prevent` is what lets it
         scroll while the page behind it does not, and it only applies where the
         pointer actually is — starting the panel lower left a strip at the top
         where a wheel landed on the header instead and nothing moved at all. -->
    <Transition name="sheet">
      <div v-if="open" class="fixed inset-0 bg-white md:hidden" />
    </Transition>
    <Transition name="menu">
      <nav
        v-if="open"
        class="menu-sheet fixed top-0 bottom-0 left-0 z-1 w-screen overflow-x-hidden overflow-y-auto overscroll-contain pt-24 pb-12 md:hidden"
        aria-label="Menu"
        data-lenis-prevent
      >
        <ul class="container mx-auto">
          <li
            v-for="(item, index) in links"
            :key="item.label"
            class="menu-row border-t border-gray/15"
            :style="{ transitionDelay: `${60 + index * 45}ms` }"
          >
            <!-- A row that can expand does only that: the whole row is the
                 control, because a chevron beside a link is a coin toss on a
                 touch screen and losing it navigates you away. Nothing is lost
                 by not linking the section here — its index page is the first
                 entry inside it. -->
            <button
              v-if="item.section"
              type="button"
              class="flex w-full cursor-pointer items-center justify-between gap-3 text-left"
              :aria-expanded="expanded === item.section"
              @click="toggle(item.section)"
            >
              <span class="text-dark block grow py-5 text-2xl">{{
                item.label
              }}</span>
              <ChevronDown
                class="text-gray size-6 shrink-0 transition-transform duration-300"
                :class="{ 'rotate-180': expanded === item.section }"
              />
            </button>
            <NuxtLink
              v-else
              :to="item.to"
              class="text-dark block py-5 text-2xl"
              @click="open = false"
              >{{ item.label }}</NuxtLink
            >

            <!-- Collapsed with `grid-template-rows: 0fr`, which animates to
                 `1fr` without anyone having to measure the list first. -->
            <div
              v-if="item.section"
              class="submenu"
              :class="{ 'submenu--open': expanded === item.section }"
            >
              <div>
                <ul
                  class="border-gray/15 flex flex-col gap-y-3 border-l pb-6 pl-4"
                >
                  <li
                    v-for="page in pagesOf(item.section)"
                    :key="page.path"
                  >
                    <NuxtLink
                      :to="page.path"
                      class="block"
                      :class="isCurrent(page.path) ? 'text-primary' : 'text-gray'"
                      @click="open = false"
                      >{{ page.title }}</NuxtLink
                    >
                  </li>
                </ul>
              </div>
            </div>
          </li>

          <li
            class="menu-row mt-8"
            :style="{ transitionDelay: `${60 + links.length * 45}ms` }"
          >
            <a
              :href="repository"
              target="_blank"
              rel="noopener"
              class="bg-primary hover:bg-primary-hover flex items-center justify-center gap-2 rounded-full px-6 py-3 text-center font-medium text-white"
              @click="open = false"
              ><GithubIcon class="size-[1.15em]" />GitHub</a
            >
          </li>
        </ul>
      </nav>
    </Transition>

    <!-- Three tracks rather than `justify-between`: the nav is centred on the
         page, not on whatever space the logo and the button leave over, so it
         stays put as either of them changes width. -->
    <!-- While the sheet is open this row is transparent to the pointer, and the
         close button takes its own back. Without it a wheel across the top of
         the screen landed on the row rather than on the panel underneath and
         nothing scrolled at all — the menu has one scrolling surface now, edge
         to edge. -->
    <div
      class="container relative z-2 mx-auto flex items-center justify-between md:grid md:grid-cols-[1fr_auto_1fr]"
      :class="{ 'pointer-events-none': open }"
    >
      <!-- Out of sight while the sheet is open. The header is not pinned any
           more, so the row stays where the document put it — and the panel
           scrolls underneath it, which had menu entries sliding behind the
           logo. `invisible` rather than `hidden`: the row keeps its size, so
           the close button opposite does not move. -->
      <NuxtLink
        to="/"
        aria-label="LokalBoards"
        :class="[
          onLight
            ? 'text-white hover:text-white/80'
            : 'text-primary hover:text-primary-hover',
          { invisible: open },
        ]"
        class="pointer-events-auto block cursor-pointer justify-self-start"
        @click="open = false"
      >
        <Logo />
      </NuxtLink>

      <nav role="navigation" class="hidden md:block md:justify-self-center">
        <ul class="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          <li v-for="item in links" :key="item.label">
            <NuxtLink :class="linkClass" :to="item.to">{{
              item.label
            }}</NuxtLink>
          </li>
        </ul>
      </nav>

      <a
        :href="repository"
        target="_blank"
        rel="noopener"
        :class="
          onLight
            ? 'bg-white text-primary hover:bg-white/90'
            : 'bg-primary hover:bg-primary-hover text-white'
        "
        class="hidden items-center gap-2 rounded-full px-6 py-3 transition-colors md:inline-flex md:justify-self-end"
        ><GithubIcon class="size-[1.15em]" />GitHub</a
      >

      <!-- Two bars that cross into a close mark, so the control never changes
           place or size — the same button, in one state or the other. -->
      <!-- Pinned while the sheet is open, at the exact offsets it rests at when
           closed, so the control does not move at the moment it is pressed. -->
      <button
        type="button"
        class="burger pointer-events-auto grid w-7 cursor-pointer gap-1.5 py-1.5 md:hidden"
        :class="[
          onLight ? 'text-white' : 'text-dark',
          { 'burger--open': open, 'fixed top-[31px] right-6 z-30 sm:right-8': open },
        ]"
        :aria-expanded="open"
        aria-label="Menu"
        @click="open = !open"
      >
        <span class="burger__bar" />
        <span class="burger__bar" />
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { ChevronDown } from "@lucide/vue";
// The four homepage sections plus the documentation. They are absolute paths
// rather than bare fragments so they work from the docs and API pages too —
// Lenis is set up with `anchors: true`, so the scroll to them is the smooth
// one the rest of the page uses.
const links = [
  { label: "About", to: "/#about" },
  { label: "Features", to: "/#features" },
  { label: "Pricing", to: "/#pricing" },
  { label: "FAQ", to: "/#faq" },
  // `section` names the content menu this row expands to show on small
  // screens, where there is no sidebar to hold it.
  // `section` must be the section's title exactly as `useDocsNavigation` gives
  // it — that string is the key the pages are looked up by. "API" instead of
  // "API reference" matched nothing, so the row opened onto an empty list.
  { label: "Docs", to: "/docs", section: "Documentation" },
  { label: "API", to: "/api", section: "API reference" },
  { label: "Changelog", to: "/changelog" },
];

// The repository rather than a mailbox. Nothing is sold here any more, so the
// most prominent thing on the page should answer the question this audience
// actually arrives with — is it real, and is it maintained — which the repo
// answers and an e-mail address does not. The address is still in the site
// notice, where the law wants it.
const repository = "https://github.com/florian-strasser/LokalBoards";

// The documentation menus, so the small-screen sheet can carry them where there
// is no room for the sidebar.
const route = useRoute();
const { sections, isCurrent, ready } = useDocsNavigation();
await ready;

const pagesOf = (title: string) =>
  sections.value.find((section) => section.title === title)?.items ?? [];

// One open at a time, and the one you are already reading opens itself.
const expanded = ref<string | null>(
  route.path.startsWith("/api")
    ? "API reference"
    : route.path.startsWith("/docs")
      ? "Documentation"
      : null,
);
const toggle = (title: string) =>
  (expanded.value = expanded.value === title ? null : title);

const props = defineProps({
  // White type and a white button, for a header sitting on something dark —
  // the hero's sky. Off, it is the ordinary dark-on-white header.
  light: { type: Boolean, default: false },
});

const open = ref(false);

// The sheet is white, so a light header would be white on white while it is
// open. The logo and the burger go dark for as long as it is.
const onLight = computed(() => props.light && !open.value);

const linkClass = computed(() =>
  props.light ? "text-white/90 hover:text-white" : "hover:text-primary",
);

// Anything that changes the page closes the menu, including a link to a section
// of the page you are already on — which is not a navigation Vue Router would
// tell us about, hence the explicit `@click` on every item as well.
watch(() => route.fullPath, () => (open.value = false));

const onKey = (event: KeyboardEvent) => {
  if (event.key === "Escape") open.value = false;
};

// Nothing behind the sheet should move while it is open.
//
// `lenis-stopped` was being put on the root by hand, which achieves nothing:
// that class is what Lenis *sets on itself* when it has been stopped, not a
// switch that stops it. Smooth scrolling carried on underneath the menu the
// whole time. `stop()` is the switch, and it is enough on its own — an
// `overflow: hidden` lock on top of it only served to take the scrollbar away
// and shift the page sideways. The gutter is reserved in the stylesheet
// instead, so there is nothing here to compensate for.
const lenis = useLenis();

watch(open, (isOpen) => {
  // `menu-open` only paints the page's scrollbar transparent — see main.css.
  document.documentElement.classList.toggle("menu-open", isOpen);
  if (isOpen) lenis.value?.stop();
  else lenis.value?.start();
});

// The sheet, the overlay and the burger are all `md:hidden`, so widening the
// window past `md` hides them — but `open` stayed true, and everything else
// that hangs off it stayed with it: the header pinned `fixed`, the scroll lock
// still on, and `onLight` still false, so the homepage's white nav came back
// dark against the blue hero. Crossing the line closes the menu, which is what
// the visitor sees happen anyway.
//
// 48rem is Tailwind's `md`. It is written out because a media query cannot read
// a utility class; if that breakpoint moves in the template, it moves here too.
const DESKTOP = "(min-width: 48rem)";
let desktop: MediaQueryList | undefined;
const closeOnDesktop = (event: MediaQueryList | MediaQueryListEvent) => {
  if (event.matches) open.value = false;
};

onMounted(() => {
  window.addEventListener("keydown", onKey);
  desktop = window.matchMedia(DESKTOP);
  desktop.addEventListener("change", closeOnDesktop);
  closeOnDesktop(desktop);
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKey);
  desktop?.removeEventListener("change", closeOnDesktop);
  document.documentElement.classList.remove("menu-open");
  lenis.value?.start();
});
</script>
