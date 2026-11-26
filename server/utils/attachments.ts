import { promises as fs } from "node:fs";
import { fail } from "./endpoint";
import {
  getFileExtension,
  getMimeType,
  provenKind,
  storedFileName,
  uploadedFile,
  writeUpload,
  type UploadKinds,
} from "./fileUtils";

// What can be attached to a card, and the extension it is stored under. The
// extension comes from the type the file proved it is, never from the name it
// arrived with.
export const ATTACHMENTS: UploadKinds = {
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

export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

// What a file brought by an import may say it is: what a card can hold, and
// the pictures and plain text other tools keep as attachments besides. Text
// has no signature to check, and is only ever saved, never shown in a tab.
const IMPORTED: UploadKinds = {
  ...ATTACHMENTS,
  "image/gif": { extension: "gif", magic: [0x47, 0x49, 0x46, 0x38] },
  "image/webp": { extension: "webp", magic: [0x52, 0x49, 0x46, 0x46] },
  "text/plain": { extension: "txt", magic: null },
};

/**
 * The type to keep for a file an import brought: the one its export gives,
 * when the bytes bear it out, and a plain file to save otherwise. An export
 * says whatever it likes — `text/html`, `image/svg+xml` — and the type kept is
 * the one the file is served with later.
 */
export function importedFileType(declared: unknown, data: Buffer): string {
  return provenKind(IMPORTED, declared, data)
    ? String(declared).toLowerCase()
    : "application/octet-stream";
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

type Attachment = { filename: string; filetype: string; filesize: number; filedata: string };

/**
 * The files sent along with a card, as the rows to keep. Each one is either a
 * file uploaded to /api/upload, named by the address that answered with, or
 * the file itself in base64 — which has to be a kind an attachment may be, and
 * is then kept as an uploaded file too. Type and size are the file's own,
 * whatever the request says about them.
 *
 * Anything else is refused: an address somewhere else, `//` and the like. A
 * card's file could otherwise be made to send whoever opens it off the
 * instance, or to claim a type that a browser runs. Every file is checked
 * before any is written, so a refusal leaves nothing behind.
 */
export async function attachmentsFrom(files: any[]): Promise<Attachment[]> {
  const checked: (Attachment | (Omit<Attachment, "filedata"> & { data: Buffer; extension: string }))[] = [];
  for (const file of files) {
    const filename = String(file?.filename ?? "").slice(0, 255) || "file";

    const stored = storedFileName(file?.filedata);
    if (stored) {
      const path = uploadedFile(stored);
      const info = path ? await fs.stat(path).catch(() => null) : null;
      if (!info?.isFile()) fail(400, "Invalid attachment");
      checked.push({
        filename,
        filetype: getMimeType(getFileExtension(stored)),
        filesize: info!.size,
        filedata: `/api/uploads/${stored}`,
      });
      continue;
    }

    const text = typeof file?.filedata === "string" ? file.filedata.replace(/\s+/g, "") : "";
    if (!BASE64.test(text)) fail(400, "Invalid attachment");
    const data = Buffer.from(text, "base64");
    if (data.length > MAX_ATTACHMENT_BYTES) fail(400, "Invalid attachment");
    const kind = provenKind(ATTACHMENTS, file?.filetype, data);
    if (!kind) fail(400, "Invalid attachment");
    checked.push({
      filename,
      filetype: String(file.filetype).toLowerCase(),
      filesize: data.length,
      data,
      extension: kind!.extension,
    });
  }

  const rows: Attachment[] = [];
  for (const row of checked) {
    if ("data" in row) {
      const { data, extension, ...meta } = row;
      rows.push({ ...meta, filedata: await writeUpload(data, extension) });
    } else {
      rows.push(row);
    }
  }
  return rows;
}
