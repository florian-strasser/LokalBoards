import { createReadStream, promises as fs } from "node:fs";
import { sendRedirect, setHeader } from "h3";
import { downloadDisposition } from "../../utils/boardExport";
import { unlinkOrphanedFiles } from "../../utils/cardCleanup";
import { showsInTab, storedFileName, uploadedFile } from "../../utils/fileUtils";

// The path of a full address, or "" for anything that is not one.
const pathOf = (value: string) => {
  try {
    return /^https?:\/\//i.test(value) ? new URL(value).pathname : "";
  } catch {
    return "";
  }
};

// The attachment asked for, with access to its card's board decided at `level`.
async function attachmentOf(
  db: any,
  id: unknown,
  cardOf: (id: unknown, level: "read" | "edit") => Promise<any>,
  level: "read" | "edit",
) {
  const [rows]: any = await db.execute(
    "SELECT id, card, filename, filetype, filesize, filedata FROM attachments WHERE id = ?",
    [positiveId(id, "Invalid attachment ID")],
  );
  if (!rows[0]) fail(404, "Resource not found");
  await cardOf(rows[0].card, level);
  return rows[0];
}

// The file's own name in the response, so the browser saves
// "Quartalszahlen.xlsx" rather than a hex string — as a download, or `inline`
// for a tab that shows it.
const disposition = (filename: string, inline: boolean) => {
  const download = downloadDisposition(filename || "file");
  return inline ? download.replace(/^attachment/, "inline") : download;
};

export default dataHandler({
  // An attachment's details, or — with `raw=1` or `download=1` — the file.
  async GET({ event, db, query, cardOf }) {
    const attachment = await attachmentOf(db, query.id, cardOf, "read");
    const wantsDownload = Boolean(query.download);
    if (!query.raw && !wantsDownload) {
      return {
        id: attachment.id,
        filename: attachment.filename,
        filetype: attachment.filetype,
        filesize: attachment.filesize,
        filedata: attachment.filedata,
      };
    }

    // `raw=1` serves the file inline, so it can be shown in a browser tab —
    // e.g. a PDF, whose in-page <iframe> rendering is unreliable on mobile.
    //
    // `download=1` serves it as a download. Only pictures and PDFs are shown
    // (see `showsInTab`); anything else is sent to be saved however it is
    // asked for, under a type that cannot be run. The type stored with an
    // attachment is what somebody's import or request said it was.
    const data: string = attachment.filedata || "";
    const inTab = showsInTab(attachment.filetype);
    const type = inTab ? String(attachment.filetype).toLowerCase() : "application/octet-stream";
    setHeader(event, "x-content-type-options", "nosniff");

    // A stored file is normally served by /api/uploads, which knows only the
    // generated storage name. For a download it is read here instead, so the
    // response carries the original filename. Older rows may hold the whole
    // address of one of the instance's own files.
    const stored = storedFileName(data) ?? storedFileName(pathOf(data));
    if (stored && wantsDownload) {
      const path = uploadedFile(stored);
      const info = path ? await fs.stat(path).catch(() => null) : null;
      if (!path || !info?.isFile()) fail(404, "Resource not found");
      setHeader(event, "content-length", info.size);
      setHeader(event, "content-type", type);
      setHeader(event, "content-disposition", disposition(attachment.filename, false));
      return createReadStream(path);
    }
    // Only ever to the instance's own file: an address anywhere else — or one
    // like `//elsewhere`, which a browser takes for another site — is not
    // followed, so a card cannot send whoever opens its file off the instance.
    if (stored) return sendRedirect(event, `/api/uploads/${stored}`, 302);
    if (/^(?:https?:)?\/\/|^\//i.test(data)) fail(404, "Resource not found");

    setHeader(event, "content-type", type);
    setHeader(event, "content-disposition", disposition(attachment.filename, inTab && !wantsDownload));
    return Buffer.from(data, "base64");
  },

  // An attachment taken off its card. Its file goes too, unless another
  // attachment still points at it.
  async DELETE({ db, query, cardOf }) {
    const attachment = await attachmentOf(db, query.id, cardOf, "edit");
    await db.execute("DELETE FROM attachments WHERE id = ?", [attachment.id]);
    await unlinkOrphanedFiles(db, [attachment]);
    return { success: true, id: attachment.id };
  },
});
