import { shallowRef } from "vue";
import { emojis, type EmojiItem } from "@tiptap/extension-emoji";
import {
  buildEmojiIndex,
  drawnAsEmoji,
  loadEmojiLanguage,
  withLanguage,
  type EmojiEntry,
  type LocalizedEmoji,
} from "~/utils/emojiSearch";

/**
 * The emoji the editor works with: the extension's list, each written so that
 * it is drawn in colour (see `asEmoji`). The editor is given this list too, so
 * what it puts into a comment is what the picker showed.
 */
export const editorEmojis: EmojiItem[] = drawnAsEmoji(emojis);

// The emoji the picker and `:` in the editor offer, shared by every editor on
// the page: the list is the same for all of them, and a description and a
// comment open at once should not build it twice.
//
// Built the first time an editor asks, because what it holds depends on the
// device — the editor has worked out which emoji this one can draw, and that is
// passed in. The instance's language is laid over it the first time someone
// actually reaches for an emoji, so an editor that is only typed in never
// fetches the names.
const entries = shallowRef<EmojiEntry[]>([]);
let built = false;
let localized: LocalizedEmoji[] | null = null;
let loading: Promise<void> | null = null;

export function useEmojiIndex() {
  const language = useState<string>("language", () => "en");

  const build = (isSupported?: (item: EmojiItem) => boolean) => {
    if (!built) {
      const index = buildEmojiIndex(editorEmojis, isSupported);
      entries.value = localized ? withLanguage(index, localized) : index;
      built = true;
    }
    return entries.value;
  };

  const loadLanguage = () => {
    loading ??= loadEmojiLanguage(language.value)
      .then((data) => {
        if (!data) return;
        localized = data;
        if (built) entries.value = withLanguage(entries.value, data);
      })
      // Without the names the English ones still work; nothing to tell anyone.
      .catch(() => {});
    return loading;
  };

  return { entries, build, loadLanguage };
}
