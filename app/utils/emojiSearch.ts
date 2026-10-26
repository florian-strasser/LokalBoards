import type { EmojiItem } from "@tiptap/extension-emoji";

// Finding an emoji by name, for the picker and for `:` typed in the editor.
//
// The emoji themselves are the editor extension's own list — the one it already
// uses to turn `:fire:` into 🔥 — so whatever can be found here can also be put
// in. Its names and search words are English. The instance's own language is
// laid over them when it has been loaded (`withLanguage`), from the same source
// the extension takes its list from, so a German instance finds ❤️ under "Herz"
// as well as under `heart`.

// The order of the groups in the picker, and the face each one shows in the
// row that jumps to it. The keys are the extension's group names; smileys come
// without one.
export const EMOJI_GROUPS = [
  { key: "", icon: "😀" },
  { key: "people & body", icon: "👋" },
  { key: "animals & nature", icon: "🐻" },
  { key: "food & drink", icon: "🍔" },
  { key: "travel & places", icon: "🚗" },
  { key: "activities", icon: "⚽" },
  { key: "objects", icon: "💡" },
  { key: "symbols", icon: "🔣" },
  { key: "flags", icon: "🏁" },
] as const;

// What used to be the whole picker. It stays as the first row: it is what the
// app has been offering, and what comments mostly need.
export const QUICK_EMOJI = ["+1", "-1", "smile", "cry", "sweat", "tada", "fire", "rocket"];

export interface EmojiEntry {
  /** The name the editor's emoji node is given — what `setEmoji` takes. */
  name: string;
  emoji: string;
  group: string;
  /** What to call it: its name in the instance's language, or `:name:`. */
  label: string;
  /** Whole names it can be found by, folded: shortcodes and the label. */
  names: string[];
  /** Single words it can be found by, folded: tags, and the words of the names. */
  words: string[];
}

/** One entry of emojibase's `compact.json` for a language. */
export interface LocalizedEmoji {
  unicode: string;
  label: string;
  tags?: string[];
}

/**
 * An emoji as it has to be written to be drawn as one. Some 350 of the
 * extension's emoji are characters a font may also draw as plain text — ❤, ☺,
 * ✌, the keycaps — and written bare, the way the extension's list has them,
 * they were: a black outline of a heart in the picker, and in the comment it
 * was put into, since the editor writes the same character the list gives it.
 * The variation selector U+FE0F after such a character asks for the coloured
 * glyph instead. It goes only where it is needed — after a character that is
 * text unless told otherwise, and not where a selector or a skin tone already
 * follows — so an emoji that was drawn right before is written exactly as
 * before.
 */
export function asEmoji(text: string): string {
  const chars = [...text];
  let out = "";
  chars.forEach((char, i) => {
    const next = chars[i + 1];
    out += char;
    // A keycap is a digit, # or * with U+20E3 round it; the selector goes
    // between the two. Anywhere else those are only text.
    const textByDefault = /[0-9#*]/.test(char)
      ? next === "\u20E3"
      : /\p{Emoji}/u.test(char) &&
        !/\p{Emoji_Presentation}/u.test(char) &&
        !/\p{Emoji_Modifier}/u.test(char);
    if (textByDefault && next !== "\uFE0F" && !(next && /\p{Emoji_Modifier}/u.test(next))) {
      out += "\uFE0F";
    }
  });
  return out;
}

/** The extension's emoji, each written so it is drawn as an emoji (`asEmoji`). */
export const drawnAsEmoji = (items: EmojiItem[]): EmojiItem[] =>
  items.map((item) => (item.emoji ? { ...item, emoji: asEmoji(item.emoji) } : item));

/** Lower case, without accents, so "Fröhlich" is found by "frohlich" too. */
export const fold = (text: string) =>
  text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// The two lists do not agree on whether ❤ carries the variation selector that
// asks for the coloured glyph (❤️). It decides nothing about which emoji it is.
const bare = (emoji: string) => emoji.replace(/️/g, "");

const split = (text: string) => text.split(/[\s_\-:]+/).filter(Boolean);

const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

/**
 * Everything the picker shows, in the order it shows it. Left out: the skin
 * tone and hair swatches, which are only ever part of another emoji; the 26
 * regional-indicator letters, which only make sense in pairs as a flag; and,
 * given `isSupported`, whatever this device cannot draw — an emoji newer than
 * its fonts shows as an empty box, which is no use to pick.
 */
export function buildEmojiIndex(
  emojis: EmojiItem[],
  isSupported: (item: EmojiItem) => boolean = () => true,
): EmojiEntry[] {
  const order = new Map<string, number>(EMOJI_GROUPS.map((group, i) => [group.key, i]));
  return emojis
    .filter(
      (item) =>
        item.emoji &&
        order.has(item.group ?? "") &&
        !item.name.startsWith("regional_indicator_") &&
        isSupported(item),
    )
    .map((item, position) => {
      const shortcodes = unique([item.name, ...(item.shortcodes ?? [])].map(fold));
      return {
        entry: {
          name: item.name,
          emoji: item.emoji as string,
          group: item.group ?? "",
          label: `:${item.name}:`,
          names: shortcodes,
          words: unique([...shortcodes.flatMap(split), ...(item.tags ?? []).map(fold)]),
        },
        position,
        group: order.get(item.group ?? "") ?? 0,
      };
    })
    .sort((a, b) => a.group - b.group || a.position - b.position)
    .map(({ entry }) => entry);
}

/** The same index, with the names and search words of a language added. */
export function withLanguage(index: EmojiEntry[], localized: LocalizedEmoji[]): EmojiEntry[] {
  const byEmoji = new Map(localized.map((item) => [bare(item.unicode), item]));
  return index.map((entry) => {
    const local = byEmoji.get(bare(entry.emoji));
    if (!local?.label) return entry;
    const label = fold(local.label);
    return {
      ...entry,
      label: local.label,
      names: unique([...entry.names, label]),
      words: unique([...entry.words, ...split(label), ...(local.tags ?? []).map(fold)]),
    };
  });
}

/**
 * The emoji a search finds, best first. A whole name beats the start of one, a
 * name beats a search word, and only then does a word merely containing the
 * text count — so "fire" puts 🔥 ahead of the fire engine, and "+1" is 👍.
 * Within a rank, the picker's own order decides. Colons around the text are
 * ignored, so `:fire:` works as well as `fire`.
 */
export function searchEmoji(index: EmojiEntry[], query: string, limit = 8): EmojiEntry[] {
  const q = fold(query.trim()).replace(/^:+|:+$/g, "");
  if (!q) return [];
  const found: { rank: number; at: number; entry: EmojiEntry }[] = [];
  index.forEach((entry, at) => {
    let rank = Infinity;
    for (const name of entry.names) {
      if (name === q) rank = Math.min(rank, 0);
      else if (name.startsWith(q)) rank = Math.min(rank, 1);
      else if (q.length > 2 && name.includes(q)) rank = Math.min(rank, 4);
    }
    if (rank > 1) {
      for (const word of entry.words) {
        if (word === q) rank = Math.min(rank, 2);
        else if (word.startsWith(q)) rank = Math.min(rank, 3);
        else if (q.length > 2 && word.includes(q)) rank = Math.min(rank, 4);
      }
    }
    if (rank < Infinity) found.push({ rank, at, entry });
  });
  found.sort((a, b) => a.rank - b.rank || a.at - b.at);
  return found.slice(0, limit).map(({ entry }) => entry);
}

// The languages emojibase has names for. Each is a file of its own, fetched the
// first time someone reaches for an emoji, and only for the instance's own
// language. Czech is not among them, and English needs none: the editor's own
// list is English already.
const LANGUAGES: Record<string, () => Promise<{ default: LocalizedEmoji[] }>> = {
  de: () => import("emojibase-data/de/compact.json"),
  es: () => import("emojibase-data/es/compact.json"),
  fr: () => import("emojibase-data/fr/compact.json"),
  it: () => import("emojibase-data/it/compact.json"),
  nl: () => import("emojibase-data/nl/compact.json"),
  pl: () => import("emojibase-data/pl/compact.json"),
  pt: () => import("emojibase-data/pt/compact.json"),
  uk: () => import("emojibase-data/uk/compact.json"),
};

/** The emoji names of a language, or null when there are none to load. */
export async function loadEmojiLanguage(code: string): Promise<LocalizedEmoji[] | null> {
  const load = LANGUAGES[code];
  if (!load) return null;
  return (await load()).default;
}
