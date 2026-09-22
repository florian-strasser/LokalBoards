import sharp from "sharp";

// Every image the app stores for itself is kept as WebP. What people upload is
// whatever their camera or screenshot tool produced — a profile picture is
// frequently a multi-megabyte JPEG displayed at 36 pixels — and that cost is
// paid again on every page that shows it.
//
// Attachments are left alone: those are files somebody deliberately attached and
// expects to download unchanged. This is only for images the app renders itself.

// A profile picture is never shown larger than this. The avatars on a card are
// 36px, the settings preview is the biggest at 144.
export const AVATAR_MAX_WIDTH = 144;

// High enough that a photograph survives it, low enough to be worth doing.
const QUALITY = 82;

export type ImagePurpose = "avatar" | "content";

/**
 * Re-encode an uploaded image as WebP, optionally bounded to a maximum width.
 * Returns the encoded bytes, or null when the buffer is not an image sharp can
 * read — the caller decides what to do about that.
 */
export async function toWebp(
  input: Buffer,
  options: { maxWidth?: number } = {},
): Promise<{ data: Buffer; width: number; height: number } | null> {
  try {
    // `animated` keeps a moving GIF moving: without it sharp reads the first
    // frame and quietly turns an animation into a still.
    let pipeline = sharp(input, { animated: true });

    if (options.maxWidth) {
      pipeline = pipeline.resize({
        width: options.maxWidth,
        // Never scale a small image up — that spends bytes to add nothing.
        withoutEnlargement: true,
      });
    }

    const { data, info } = await pipeline
      .webp({ quality: QUALITY })
      .toBuffer({ resolveWithObject: true });

    return { data, width: info.width, height: info.height };
  } catch {
    return null;
  }
}

/** The width bound that applies to an upload of this kind, if any. */
export function widthFor(purpose: ImagePurpose): number | undefined {
  return purpose === "avatar" ? AVATAR_MAX_WIDTH : undefined;
}

/**
 * Stores an image the way one pasted into a card is stored — re-encoded as
 * WebP under `public/uploads` — and answers with the address to put in the
 * text, or null when the bytes are not an image.
 */
export async function saveContentImage(input: Buffer): Promise<string | null> {
  const encoded = await toWebp(input, { maxWidth: widthFor("content") });
  if (!encoded) return null;
  const { promises: fs } = await import("node:fs");
  const { join } = await import("node:path");
  const { randomBytes } = await import("node:crypto");
  const uploadDir = join(process.cwd(), "public", "uploads");
  await fs.mkdir(uploadDir, { recursive: true });
  const name = `${randomBytes(16).toString("hex")}.webp`;
  await fs.writeFile(join(uploadDir, name), encoded.data);
  return `/api/uploads/${name}`;
}
