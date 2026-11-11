<template>
  <div class="ui lang" aria-hidden="true">
    <!-- One button out of the app, relabelling itself. The strings are the real
         `createNewCard` values from the locale files, not translations invented
         for a screenshot — including the two beyond the Latin alphabet. -->
    <span class="lang__code">{{ current.code }}</span>

    <!-- Width is animated rather than left to the content, so the button eases
         out and settles instead of snapping to each new length. It has to be a
         measured pixel value: `width: auto` is not something CSS can
         transition between. -->
    <span class="ui-button lang__button" :style="buttonStyle">
      <Plus :stroke-width="2.5" />
      <span class="lang__label" :class="{ 'lang__label--out': swapping }">{{
        current.label
      }}</span>
    </span>

    <!-- An off-screen copy of the whole button for every language, purely to
         measure. Copying the button rather than just the text means the
         padding, the gap and the icon are all in the number already. -->
    <span ref="ruler" class="lang__ruler">
      <span
        v-for="entry in languages"
        :key="entry.code"
        class="ui-button lang__measure"
      >
        <Plus :stroke-width="2.5" />
        <span class="lang__label">{{ entry.label }}</span>
      </span>
    </span>

    <p class="lang__count">10 languages</p>
  </div>
</template>

<script setup lang="ts">
import { Plus } from "@lucide/vue";

const languages = [
  { code: "EN", label: "Create new card" },
  { code: "DE", label: "Neue Karte erstellen" },
  { code: "FR", label: "Créer une nouvelle carte" },
  { code: "ES", label: "Crear una nueva tarjeta" },
  { code: "IT", label: "Crea una nuova carta" },
  { code: "NL", label: "Nieuwe kaart aanmaken" },
  { code: "PL", label: "Utwórz nową kartę" },
  { code: "UK", label: "Створити картку" },
  { code: "PT", label: "Criar novo cartão" },
  { code: "CS", label: "Vytvořit novou kartu" },
];

const index = ref(0);
const swapping = ref(false);
const widths = ref<number[]>([]);
const ruler = ref<HTMLElement | null>(null);

const current = computed(() => languages[index.value]!);

// Until the labels have been measured the button sizes itself, which is also
// what the server renders — so the markup matches on hydration and the first
// paint is never a zero-width button.
const buttonStyle = computed(() =>
  widths.value.length ? { width: `${widths.value[index.value]}px` } : {},
);

let timer: ReturnType<typeof setInterval> | undefined;
let swapTimer: ReturnType<typeof setTimeout> | undefined;

onMounted(() => {
  const measure = () => {
    const copies = ruler.value?.querySelectorAll(".lang__measure");
    if (!copies?.length) return;
    widths.value = [...copies].map((el) =>
      Math.ceil((el as HTMLElement).getBoundingClientRect().width),
    );
  };
  measure();
  // Re-measure once the webfont lands, or every width is a fallback-font width.
  document.fonts?.ready.then(measure);
  window.addEventListener("resize", measure);
  onUnmounted(() => window.removeEventListener("resize", measure));

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  timer = setInterval(() => {
    // Fade the old label out, change it while nothing is readable, fade the new
    // one in — the width eases across the whole exchange.
    swapping.value = true;
    swapTimer = setTimeout(() => {
      index.value = (index.value + 1) % languages.length;
      swapping.value = false;
    }, 180);
  }, 2600);
});

onUnmounted(() => {
  clearInterval(timer);
  clearTimeout(swapTimer);
});
</script>
