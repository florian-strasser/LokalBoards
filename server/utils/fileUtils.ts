import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { extname, resolve, sep } from "node:path";
import {
  createError,
  getRequestHeader,
  readMultipartFormData,
  type H3Event,
  type MultiPartData,
} from "h3";

// Every file people upload — an attachment, a picture pasted into a card, an
// avatar — is kept in one folder, under a name the server made up, and served
// from /api/uploads/<name>. The name a person gave a file stays in the
// database; on disk it is never used, so it cannot lead anywhere it should not.

/** The folder uploaded files are kept in. */
export function uploadsFolder(): string {
  return resolve(process.cwd(), "public", "uploads");
}

// How a stored file is written in an attachment's `filedata` or in a card's
// text. Older rows say `/uploads/<name>`.
const STORED_FILE = /^\/(?:api\/)?uploads\/([A-Za-z0-9._-]+)$/;

/**
 * The name of the uploaded file `filedata` points at, or null when it is not
 * one: base64 kept in the row, or an address somewhere else.
 */
export function storedFileName(filedata: unknown): string | null {
  return String(filedata || "").match(STORED_FILE)?.[1] ?? null;
}

/**
 * Where on disk the file with this name is, or null for a name that would
 * lead out of the folder. A stored name cannot, the pattern above has no room
 * for a separator; this is the check that holds whatever the name came from.
 */
export function uploadedFile(name: string): string | null {
  const folder = uploadsFolder();
  const path = resolve(folder, name);
  return path.startsWith(folder + sep) ? path : null;
}

// Random, so that knowing one file's address says nothing about another's.
const freshName = (extension: string) =>
  `${randomBytes(16).toString("hex")}${extension ? `.${extension}` : ""}`;

/** These bytes kept as a new uploaded file; answers with its address. */
export async function writeUpload(data: Buffer, extension: string): Promise<string> {
  const folder = uploadsFolder();
  await fs.mkdir(folder, { recursive: true });
  const name = freshName(extension);
  await fs.writeFile(resolve(folder, name), data);
  return `/api/uploads/${name}`;
}

/**
 * A copy of an uploaded file under a name of its own; answers with its
 * address. Throws when the original is not there to copy.
 */
export async function copyUpload(name: string): Promise<string> {
  const source = uploadedFile(name);
  if (!source) throw new Error(`Not an uploaded file: ${name}`);
  const copy = freshName(extname(name).slice(1));
  await fs.copyFile(source, resolve(uploadsFolder(), copy));
  return `/api/uploads/${copy}`;
}

/**
 * The kinds of file an upload route takes: each content type, the extension
 * it is stored under, and the bytes a file of that type starts with — null for
 * one that has none to check, such as CSV.
 */
export type UploadKinds = Record<string, { extension: string; magic: number[] | null }>;

/**
 * The file a multipart request carries, once it has shown it is what it says:
 * one of the kinds the route takes, no bigger than `maxBytes`, and starting the
 * way a file of its type starts. The declared type is only the browser's guess
 * from the file's name, so it proves nothing by itself. `pick` chooses the
 * file among the parts; every other part is there for the route to read.
 *
 * Anything that fails is a 400 that says no more than "Invalid request".
 */
export async function readUpload(
  event: H3Event,
  kinds: UploadKinds,
  maxBytes: number,
  pick: (parts: MultiPartData[]) => MultiPartData | undefined,
) {
  const invalid = () => createError({ statusCode: 400, statusMessage: "Invalid request" });
  if (!getRequestHeader(event, "content-type")?.includes("multipart/form-data")) {
    throw invalid();
  }
  const parts = (await readMultipartFormData(event)) ?? [];
  const file = parts.length ? pick(parts) : undefined;
  const kind = file?.type ? kinds[file.type.toLowerCase()] : undefined;
  if (!file || !kind) throw invalid();

  const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
  if (data.length > maxBytes) throw invalid();
  if (kind.magic && !kind.magic.every((byte, index) => data[index] === byte)) {
    throw invalid();
  }
  return { file, parts, data, extension: kind.extension };
}

export function getFileExtension(filename: string): string {
  const parts = filename.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

export function getMimeType(extension: string): string {
  const mimeTypes: Record<string, string> = {
    // Images
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",

    // Documents
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    csv: "text/csv",

    // Archives
    zip: "application/zip",
    rar: "application/x-rar-compressed",
    tar: "application/x-tar",
    gz: "application/gzip",

    // Text
    txt: "text/plain",
    html: "text/html",
    htm: "text/html",
    css: "text/css",
    js: "text/javascript",
    json: "application/json",

    // Other
    mp4: "video/mp4",
    mp3: "audio/mpeg",
    wav: "audio/wav",
  };

  return mimeTypes[extension] || "application/octet-stream";
}
