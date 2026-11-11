import { createError, defineEventHandler } from "h3";
import { requireUploader } from "../utils/auth";
import { readUpload, writeUpload, type UploadKinds } from "../utils/fileUtils";

// What can be attached to a card, and the extension it is stored under. The
// extension comes from the type the file proved it is, never from the name it
// arrived with.
const ATTACHMENTS: UploadKinds = {
  "application/pdf": { extension: "pdf", magic: [0x25, 0x50, 0x44, 0x46] },
  "application/msword": { extension: "doc", magic: [0xd0, 0xcf, 0x11, 0xe0] },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    extension: "docx",
    magic: [0x50, 0x4b, 0x03, 0x04],
  },
  "application/vnd.ms-excel": { extension: "xls", magic: [0xd0, 0xcf, 0x11, 0xe0] },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    extension: "xlsx",
    magic: [0x50, 0x4b, 0x03, 0x04],
  },
  // Plain text has no signature to check.
  "text/csv": { extension: "csv", magic: null },
  "application/vnd.ms-powerpoint": { extension: "ppt", magic: [0xd0, 0xcf, 0x11, 0xe0] },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": {
    extension: "pptx",
    magic: [0x50, 0x4b, 0x03, 0x04],
  },
  "image/jpeg": { extension: "jpg", magic: [0xff, 0xd8, 0xff] },
  "image/png": { extension: "png", magic: [0x89, 0x50, 0x4e, 0x47] },
  "application/zip": { extension: "zip", magic: [0x50, 0x4b, 0x03, 0x04] },
};

const MAX_FILE_SIZE = 50 * 1024 * 1024;

// A file for a card, kept as it arrived: somebody attached it deliberately
// and expects to download it unchanged.
export default defineEventHandler(async (event) => {
  try {
    await requireUploader(event);
    const { file, data, extension } = await readUpload(
      event,
      ATTACHMENTS,
      MAX_FILE_SIZE,
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
