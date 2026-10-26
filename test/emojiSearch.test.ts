import { describe, it, expect } from "vitest";
import { emojis } from "@tiptap/extension-emoji";
import german from "emojibase-data/de/compact.json";
import english from "emojibase-data/en/compact.json";
import {
  EMOJI_GROUPS,
  QUICK_EMOJI,
  asEmoji,
  buildEmojiIndex,
  drawnAsEmoji,
  fold,
  loadEmojiLanguage,
  searchEmoji,
  withLanguage,
} from "../app/utils/emojiSearch";

// The emoji the picker shows and the `:` list finds, against the editor
// extension's real list — what is searched here is what the editor can insert.

const index = buildEmojiIndex(emojis);
// The extension writes ❤ without the selector that asks for the coloured
// glyph, emojibase with it; which one is which emoji does not depend on it.
const bare = (emoji?: string) => emoji?.replace(/\uFE0F/g, "");
const first = (query: string, within = index) => bare(searchEmoji(within, query, 8)[0]?.emoji);
const found = (query: string, within = index, limit = 8) =>
  searchEmoji(within, query, limit).map((entry) => bare(entry.emoji));

describe("what is on offer", () => {
  it("is nearly all of the extension's emoji", () => {
    expect(index.length).toBeGreaterThan(1800);
  });

  it("leaves out what is not an emoji of its own", () => {
    const names = new Set(index.map((entry) => entry.name));
    // Skin tones and hair are only ever part of another emoji…
    expect(names.has("tone1")).toBe(false);
    expect(names.has("red_hair")).toBe(false);
    // …and a regional-indicator letter is half a flag.
    expect(names.has("regional_indicator_a")).toBe(false);
    expect(names.has("de")).toBe(true);
  });

  it("leaves out what the device cannot draw", () => {
    const old = buildEmojiIndex(emojis, (item) => (item.version ?? 0) < 13);
    expect(old.length).toBeLessThan(index.length);
    expect(old.some((entry) => entry.name === "smile")).toBe(true);
  });

  it("comes in the picker's group order", () => {
    const groups = [...new Set(index.map((entry) => entry.group))];
    expect(groups).toEqual(EMOJI_GROUPS.map((group) => group.key));
  });

  it("still has every emoji of the old picker", () => {
    const names = new Set(index.map((entry) => entry.name));
    expect(QUICK_EMOJI.filter((name) => !names.has(name))).toEqual([]);
  });
});

describe("searching", () => {
  it("finds a whole name before anything that merely mentions it", () => {
    expect(first("fire")).toBe("🔥");
    expect(first("heart")).toBe("❤");
    expect(first("rocket")).toBe("🚀");
  });

  it("knows the other names an emoji goes by", () => {
    expect(first("+1")).toBe("👍");
    expect(first("thumbsup")).toBe("👍");
    expect(first("tada")).toBe("🎉");
  });

  it("finds a name from its start, as it is being typed", () => {
    expect(found("roc")).toContain("🚀");
    // 😃 is "smiley", so it starts the same; both are there.
    expect(found("smil")).toEqual(expect.arrayContaining(["😃", "😄"]));
  });

  it("takes the colons a shortcode is written with", () => {
    expect(first(":fire:")).toBe("🔥");
    expect(first(":fire")).toBe("🔥");
  });

  it("is not fooled by case", () => {
    expect(first("FIRE")).toBe("🔥");
  });

  it("finds nothing for nothing", () => {
    expect(searchEmoji(index, "")).toEqual([]);
    expect(searchEmoji(index, "  ")).toEqual([]);
    expect(searchEmoji(index, "qxzqxz")).toEqual([]);
  });

  it("returns no more than it is asked for", () => {
    expect(searchEmoji(index, "face", 5)).toHaveLength(5);
  });

  it("only looks inside words from the third letter", () => {
    // "ir" is in "fire", but two letters are far too few to go by.
    expect(searchEmoji(index, "ir").map((entry) => entry.name)).not.toContain("fire");
  });
});

describe("in the instance's language", () => {
  const de = withLanguage(index, german);

  it("finds emoji by their German names and words", () => {
    // German calls a dozen emoji "…herz"; the red one is among them, and
    // first for its whole name.
    expect(found("herz", de, 200)).toContain("❤");
    expect(first("rotes herz", de)).toBe("❤");
    expect(first("rakete", de)).toBe("🚀");
    expect(first("daumen hoch", de)).toBe("👍");
  });

  it("without losing the English shortcodes", () => {
    expect(first("fire", de)).toBe("🔥");
    expect(first("+1", de)).toBe("👍");
  });

  it("calls an emoji by its German name", () => {
    expect(de.find((entry) => entry.name === "rocket")?.label).toBe("Rakete");
  });

  it("does not mind accents", () => {
    expect(fold("Fröhlich")).toBe("frohlich");
  });

  it("loads only languages there are names for", async () => {
    expect(await loadEmojiLanguage("en")).toBeNull();
    expect(await loadEmojiLanguage("cs")).toBeNull();
    expect((await loadEmojiLanguage("de"))?.length).toBeGreaterThan(1800);
  });
});

describe("drawn as an emoji", () => {
  const codes = (text: string) => [...text].map((char) => char.codePointAt(0)!.toString(16)).join(" ");

  it("asks for the coloured glyph where a font would draw text", () => {
    expect(codes(asEmoji("❤"))).toBe("2764 fe0f");
    expect(codes(asEmoji("☺"))).toBe("263a fe0f");
    expect(codes(asEmoji("#\u20E3"))).toBe("23 fe0f 20e3");
  });

  it("leaves alone what is drawn right already", () => {
    expect(asEmoji("👍")).toBe("👍");
    expect(asEmoji("❤️")).toBe("❤️");
    expect(asEmoji("❤️‍🔥")).toBe("❤️‍🔥");
    expect(asEmoji("🇩🇪")).toBe("🇩🇪");
  });

  it("agrees with emojibase on every emoji that needs it, and adds it nowhere else", () => {
    const qualified = new Map(english.map((item) => [item.unicode.replace(/\uFE0F/g, ""), item.unicode]));
    // A selector after a character that is text by default — the ones that matter.
    const needed = (text: string) =>
      [...text].filter((char, i, all) => all[i + 1] === "\uFE0F" && !/\p{Emoji_Presentation}/u.test(char)).length;
    const selectors = (text: string) => (text.match(/\uFE0F/g) ?? []).length;
    const wrong = drawnAsEmoji(emojis).filter((item) => {
      const reference = qualified.get(item.emoji!.replace(/\uFE0F/g, ""))!;
      return needed(item.emoji!) < needed(reference) || selectors(item.emoji!) > selectors(reference);
    });
    expect(wrong.map((item) => item.name)).toEqual([]);
  });

  it("is what the picker offers", () => {
    const heart = buildEmojiIndex(drawnAsEmoji(emojis)).find((entry) => entry.name === "heart");
    expect(heart?.emoji).toBe("❤️");
  });
});
