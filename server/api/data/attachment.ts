import { createReadStream, promises as fs } from "node:fs";
import { sendRedirect, setHeader } from "h3";
import { downloadDisposition } from "../../utils/boardExport";
import { unlinkOrphanedFiles } from "../../utils/cardCleanup";
import { storedFileName, uploadedFile } from "../../utils/fileUtils";

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
    // `download=1` serves it as a download. Only images and PDFs can be
    // displayed; a spreadsheet or a Word file can only ever be saved, so the
    // response says so instead of leaving it to the browser to work out.
    const data: string = attachment.filedata || "";
    const filetype = attachment.filetype || "application/octet-stream";

    // A stored file is normally served by /api/uploads, which knows only the
    // generated storage name and always says `inline`. For a download it is
    // read here instead, so the response carries the original filename.
    const stored = storedFileName(data);
    if (stored && wantsDownload) {
      const path = uploadedFile(stored);
      const info = path ? await fs.stat(path).catch(() => null) : null;
      if (!path || !info?.isFile()) fail(404, "Resource not found");
      setHeader(event, "content-length", info.size);
      setHeader(event, "content-type", filetype);
      setHeader(event, "content-disposition", disposition(attachment.filename, false));
      return createReadStream(path);
    }

    if (/^https?:\/\//.test(data) || data.startsWith("/")) {
      return sendRedirect(event, data, 302);
    }
    setHeader(event, "content-type", filetype);
    setHeader(event, "content-disposition", disposition(attachment.filename, !wantsDownload));
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
