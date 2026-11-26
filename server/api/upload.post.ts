import { createError, defineEventHandler } from "h3";
import { ATTACHMENTS, MAX_ATTACHMENT_BYTES } from "../utils/attachments";
import { requireUploader } from "../utils/auth";
import { readUpload, writeUpload } from "../utils/fileUtils";

// A file for a card, kept as it arrived: somebody attached it deliberately
// and expects to download it unchanged. The kinds it may be are in
// attachments.ts, shared with a card that is sent its files in base64.
export default defineEventHandler(async (event) => {
  try {
    await requireUploader(event);
    const { file, data, extension } = await readUpload(
      event,
      ATTACHMENTS,
      MAX_ATTACHMENT_BYTES,
      // The first part, and only if it is a file rather than a plain field.
      (parts) => (parts[0].filename ? parts[0] : undefined),
    );
    return {
      success: true,
      url: await writeUpload(data, extension),
      type: file.type,
      size: data.length,
    };
  } catch (error: any) {
    // A refusal — not signed in, a read-only key, a file of the wrong kind —
    // keeps its own status; only something unexpected is the server's fault.
    if (error?.statusCode) throw error;
    logger.error("File upload error:", error);
    throw createError({
      statusCode: 500,
      statusMessage: "Upload failed",
    });
  }
});
