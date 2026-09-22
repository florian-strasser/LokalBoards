import type { ImportFile } from "./boardImport";

// Fetching a file a Trello board links to, for both ways a Trello board comes
// in: its public link, and the JSON file Trello exports.
//
// An uploaded attachment is a link like
// `https://trello.com/1/cards/<card>/attachments/<id>/download/<name>`, and an
// image pasted into a description links to a preview of one:
// `…/attachments/<id>/previews/<preview>/download/<name>`. For a public board
// both redirect to a signed copy on files.trello.com that anybody can fetch.
// For a private board they want somebody signed in to Trello. The server is
// not, but the person importing is, and can hand it a token of theirs (see
// `trelloFiles.ts`); with that, Trello's API accepts the request as theirs, in
// an `Authorization` header — the only way it takes one for these addresses.
// Without a token the card keeps a link to each file instead.
//
// A file somebody uploads can say anything, so only that one kind of address
// is ever requested: https, trello.com itself, an attachment download. Where
// Trello redirects it from there is Trello's business. Anything else in the
// file stays a link and is never fetched.

const MAX_BYTES = 10 * 1024 * 1024;

const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
  zip: "application/zip",
  mp4: "video/mp4",
  mov: "video/quicktime",
};

// Trello's own mimeType is often null and the download a generic octet-stream,
// so a well-known extension wins (it is what lets the app show an image as one)
// before the reported types.
export function guessMimeType(
  name: string,
  provided: string,
  responseType: string,
): string {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (EXT_MIME[ext]) return EXT_MIME[ext];
  if (provided && provided.includes("/")) return provided;
  if (responseType && responseType.includes("/") && !responseType.includes("html")) {
    return responseType.split(";")[0].trim();
  }
  return "application/octet-stream";
}

export function isTrelloAttachmentUrl(url: unknown): boolean {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname === "trello.com" &&
      parsed.port === "" &&
      !parsed.username &&
      !parsed.password &&
      /^\/1\/cards\/[A-Za-z0-9]+\/attachments\/[A-Za-z0-9]+\/(?:previews\/[A-Za-z0-9]+\/)?download\//.test(
        parsed.pathname,
      )
    );
  } catch {
    return false;
  }
}

export interface TrelloAuth {
  key: string;
  token: string;
}

/** What Trello takes for a token, or null for anything that is not one. */
export function trelloToken(value: unknown): string | null {
  const token = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9_-]{20,256}$/.test(token) ? token : null;
}

export function trelloAuthHeader(auth: TrelloAuth): string {
  return `OAuth oauth_consumer_key="${auth.key}", oauth_token="${auth.token}"`;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The file's bytes and type, or null when Trello will not hand it over. With
 * `auth`, as the person whose token it is. Trello allows a hundred requests in
 * ten seconds for a token; a busy board can meet that, so a request told to
 * slow down waits and tries again, twice.
 */
export async function downloadTrelloAttachment(
  file: ImportFile,
  auth?: TrelloAuth | null,
): Promise<{ buffer: Buffer; type: string } | null> {
  if (!isTrelloAttachmentUrl(file.url)) return null;
  if (file.bytes && file.bytes > MAX_BYTES) return null;
  try {
    const headers: Record<string, string> = {
      "user-agent": "LokalBoards board importer",
    };
    if (auth) headers.authorization = trelloAuthHeader(auth);
    let res: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      // Redirected to files.trello.com, the request goes without the header:
      // fetch leaves it behind on another host, and the signed address there
      // does not need it.
      res = await fetch(file.url!, {
        redirect: "follow",
        headers,
        signal: AbortSignal.timeout(30000),
      });
      if (res.status !== 429) break;
      const after = Number(res.headers.get("retry-after") || 0);
      await wait(Math.min(after > 0 ? after * 1000 : 2000 * (attempt + 1), 15000));
    }
    if (!res || !res.ok) return null;
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared && declared > MAX_BYTES) return null;
    const body = await res.arrayBuffer();
    if (body.byteLength === 0 || body.byteLength > MAX_BYTES) return null;
    return {
      buffer: Buffer.from(body),
      type: guessMimeType(
        file.name,
        file.type,
        res.headers.get("content-type") || "",
      ),
    };
  } catch (error: any) {
    // The message only: a request's details would include the token.
    logger.error("Trello attachment download failed:", error?.message);
    return null;
  }
}
