import { VueRenderer } from "@tiptap/vue-3";
import type { SuggestionOptions } from "@tiptap/suggestion";
import EmojiSuggestion from "~/components/EmojiSuggestion.vue";
import { searchEmoji, type EmojiEntry } from "~/utils/emojiSearch";

/**
 * The list that opens while `:fi…` is typed, for the Emoji extension's
 * `suggestion` option. The extension already listens for `:` and knows how to
 * put the chosen emoji in; this adds what it offers and how it looks.
 *
 * Two letters before anything opens: `:D` and `:P` are smileys being typed, and
 * the extension turns those into emoji by itself once the space comes.
 *
 * The list is placed by the suggestion plugin, in <body> and `fixed` — the
 * editor sits in a dialog that is itself moved by a transform, and anything
 * fixed inside that would be placed against the dialog rather than the window.
 */
export function emojiSuggestion(
  entries: () => EmojiEntry[],
  onOpen: () => void,
): Partial<SuggestionOptions<EmojiEntry, { name: string }>> {
  return {
    minQueryLength: 2,
    items: ({ query }) => searchEmoji(entries(), query, 8),
    floatingUi: { strategy: "fixed" },
    render: () => {
      let renderer: VueRenderer | null = null;
      let unmount: (() => void) | null = null;
      return {
        onStart: (props) => {
          onOpen();
          renderer = new VueRenderer(EmojiSuggestion, {
            props: { items: props.items, command: props.command },
            editor: props.editor,
          });
          if (renderer.element) unmount = props.mount(renderer.element as HTMLElement);
        },
        onUpdate: (props) => {
          renderer?.updateProps({ items: props.items, command: props.command });
        },
        onKeyDown: ({ event }) => renderer?.ref?.onKeyDown(event) ?? false,
        onExit: () => {
          unmount?.();
          unmount = null;
          renderer?.destroy();
          renderer = null;
        },
      };
    },
  };
}
