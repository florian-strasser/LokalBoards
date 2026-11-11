import { setHeader } from "h3";
import {
  addEntries,
  boardFolder,
  buildBoardExport,
  createZip,
  downloadDisposition,
  exportDate,
} from "../../utils/boardExport";
import { boardCsv } from "../../utils/cardsCsv";

// One board, as a zip: its JSON and the files its cards hold. Or, with
// `?format=csv`, its cards as a spreadsheet.
//
// Anybody who can see a board can take it with them. Every card, comment and
// attachment in here is something they could already open one at a time; this
// saves them the clicking.

export default dataHandler({
  async GET({ event, db, query, boardOf }) {
    const { board } = await boardOf(
      positiveId(query.boardId, "Required fields are missing"),
      "read",
    );

    const now = new Date();
    const folder = boardFolder(board);
    const config = useRuntimeConfig();

    // The same board as a spreadsheet: its cards, one per row, for somebody
    // who reports on the work rather than moves it somewhere else.
    if (query.format === "csv") {
      const csv = await boardCsv(db, board.id, {
        language: config.language,
        baseUrl: config.boardsUrl,
      });
      setHeader(event, "content-type", "text/csv; charset=utf-8");
      setHeader(
        event,
        "content-disposition",
        downloadDisposition(`${folder}-${exportDate(now)}.csv`),
      );
      setHeader(event, "cache-control", "no-store");
      return csv;
    }

    // Built before anything is sent, so a failure is still an error response
    // rather than a download that stops halfway.
    const built = await buildBoardExport(db, board.id, {
      filesAt: "attachments/",
      version: config.appVersion ?? null,
      now,
    });
    if (!built) fail(404, "Resource not found");

    const archive = createZip();
    archive.on("warning", (error: any) =>
      logger.warn("Board export:", error?.message),
    );
    archive.on("error", (error: any) => {
      logger.error("Board export failed:", error?.message);
      event.node.res.destroy();
    });
    archive.append(JSON.stringify(built.json, null, 2), {
      name: `${folder}.json`,
    });
    addEntries(archive, built.entries);
    archive.finalize();

    setHeader(event, "content-type", "application/zip");
    setHeader(
      event,
      "content-disposition",
      downloadDisposition(`${folder}-${exportDate(now)}.zip`),
    );
    setHeader(event, "cache-control", "no-store");
    return archive;
  },
});
