import { createError, defineEventHandler } from "h3";
import { requireUploader } from "../../utils/auth";
import { readUpload, writeUpload, type UploadKinds } from "../../utils/fileUtils";
import { toWebp, widthFor, type ImagePurpose } from "../../utils/imageProcessing";

// What arrives may be any of these; what is kept is always WebP.
const IMAGES: UploadKinds = {
  "image/png": { extension: "png", magic: [0x89, 0x50, 0x4e, 0x47] },
  "image/jpeg": { extension: "jpg", magic: [0xff, 0xd8, 0xff] },
  "image/gif": { extension: "gif", magic: [0x47, 0x49, 0x46, 0x38] },
  "image/webp": { extension: "webp", magic: [0x52, 0x49, 0x46, 0x46] },
};

const MAX_FILE_SIZE = 10 * 1024 * 1024;

// A picture the app shows itself: one pasted into a card, or somebody's avatar.
export default defineEventHandler(async (event) => {
  try {
    await requireUploader(event);
    const { parts, data } = await readUpload(event, IMAGES, MAX_FILE_SIZE, (parts) =>
      parts.find((part) => part.name === "image" || part.name === "file"),
    );

    // What the image is for decides whether it is bounded in size. A profile
    // picture is never drawn larger than 144px, so there is no reason to keep
    // the 4000px original of it; anything else keeps its dimensions.
    const purposeField = parts.find((part) => part.name === "purpose");
    const purpose: ImagePurpose =
      purposeField?.data?.toString() === "avatar" ? "avatar" : "content";

    // Stored as WebP whatever arrived. An image the app renders itself is
    // downloaded by everyone who opens the page it is on, and a phone camera's
    // JPEG is an expensive way to draw a 36px avatar.
    const encoded = await toWebp(data, { maxWidth: widthFor(purpose) });
    if (!encoded) {
      throw createError({
        statusCode: 400,
        statusMessage: "Invalid request",
      });
    }

    return {
      success: true,
      imageUrl: await writeUpload(encoded.data, "webp"),
      // What was stored, not what arrived — the caller asked for a file and
      // this is the file it got.
      type: "image/webp",
      size: encoded.data.length,
      width: encoded.width,
      height: encoded.height,
    };
  } catch (error: any) {
    // A refusal already knows what it is — a file that is not an image, or is
    // too big — and saying "Upload failed" with a 500 tells the caller the
    // server broke when it was the file that was wrong. Only something
    // genuinely unexpected becomes a 500.
    if (error?.statusCode) throw error;
    logger.error("Image upload error:", error);
    throw createError({
      statusCode: 500,
      statusMessage: "Upload failed",
    });
  }
});
