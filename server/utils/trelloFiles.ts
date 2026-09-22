import type { ImportBoard, ImportFile } from "./boardImport";

// A Trello board's files, brought over rather than linked to.
//
// Trello's JSON names its files by address. Two kinds matter: a card's
// attachments, and the pictures pasted into a description or a comment, which
// are Markdown images pointing at a preview of one of those attachments. On a
// private board every one of those addresses needs somebody signed in to
// Trello; see `trelloDownload.ts` for how the person importing lends the
// server their access for that.
//
// Every attachment that can be fetched becomes a real attachment here, and
// every picture in the text is stored the way a picture pasted into a card is
// and its address rewritten to the copy — so nothing on the imported board
// depends on Trello still being there, or on the reader being signed in to it.
// What cannot be fetched is left as it was; the writer lists attachments like
// that on their card as links.
//
// The fetching and the storing are passed in, so all of this can be tested
// without Trello and without a disk.

type Fetched = { buffer: Buffer; type: string } | null;

export interface TrelloFileOptions {
  download: (file: ImportFile) => Promise<Fetched>;
  saveImage: (buffer: Buffer) => Promise<string | null>;
  // At most this many files are fetched for one board.
  limit?: number;
}

// A Trello file address in text: the attachment, optionally one of its
// previews, then its name. Stops at whatever ends a Markdown link.
const TRELLO_FILE =
  /https:\/\/trello\.com\/1\/cards\/[A-Za-z0-9]+\/attachments\/([A-Za-z0-9]+)(?:\/previews\/[A-Za-z0-9]+)?\/download\/[^\s)"'<>\]]+/g;

const attachmentIdOf = (url: string | undefined) =>
  url?.match(/\/attachments\/([A-Za-z0-9]+)\//)?.[1] ?? null;

const DOWNLOADS_AT_ONCE = 6;

async function eachAtOnce<T>(items: T[], work: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await work(items[next++]);
  };
  await Promise.all(
    Array.from({ length: Math.min(DOWNLOADS_AT_ONCE, items.length) }, worker),
  );
}

export async function bringTrelloFiles(
  board: ImportBoard,
  options: TrelloFileOptions,
): Promise<{ board: ImportBoard; fetched: number; images: number }> {
  const limit = options.limit ?? 300;
  const cards = board.areas.flatMap((area) => area.cards);

  // The attachments first, a few at a time.
  const wanted = cards
    .flatMap((card) => card.files)
    .filter((file) => file.url && !file.data)
    .slice(0, limit);
  const bytesByAttachment = new Map<string, Buffer>();
  let fetched = 0;
  await eachAtOnce(wanted, async (file) => {
    const got = await options.download(file);
    if (!got) return;
    file.data = got.buffer.toString("base64");
    file.type = got.type || file.type;
    const id = attachmentIdOf(file.url);
    if (id) bytesByAttachment.set(id, got.buffer);
    delete file.url;
    fetched++;
  });

  // Then the pictures in the text. One picked from the card's own
  // attachments is already here; anything else is fetched by its address.
  const texts: Array<{ get: () => string; set: (text: string) => void }> = [];
  for (const card of cards) {
    texts.push({ get: () => card.content, set: (text) => (card.content = text) });
    for (const comment of card.comments) {
      texts.push({
        get: () => comment.content,
        set: (text) => (comment.content = text),
      });
    }
  }
  const addresses = new Set<string>();
  for (const text of texts) {
    for (const match of text.get().matchAll(TRELLO_FILE)) addresses.add(match[0]);
  }

  const localFor = new Map<string, string>();
  const savedByAttachment = new Map<string, Promise<string | null>>();
  let images = 0;
  await eachAtOnce([...addresses], async (address) => {
    const id = attachmentIdOf(address);
    let buffer = id ? bytesByAttachment.get(id) : undefined;
    if (!buffer) {
      const got = await options.download({ name: "", type: "", url: address });
      if (!got) return;
      buffer = got.buffer;
    }
    // Several addresses of one attachment — its download and its previews —
    // share one stored copy.
    const key = id && bytesByAttachment.has(id) ? id : address;
    if (!savedByAttachment.has(key)) {
      savedByAttachment.set(key, options.saveImage(buffer));
    }
    const local = await savedByAttachment.get(key)!;
    if (local) {
      localFor.set(address, local);
    }
  });
  images = new Set(localFor.values()).size;

  if (localFor.size) {
    for (const text of texts) {
      text.set(
        text.get().replace(TRELLO_FILE, (address) => localFor.get(address) ?? address),
      );
    }
  }

  return { board, fetched, images };
}
