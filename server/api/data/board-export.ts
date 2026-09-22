import { defineEventHandler, getQuery, setHeader } from "h3";
import { setupDatabase } from "../../../app/lib/databaseSetup";
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

export default defineEventHandler(async (event) => {
  if (event.req.method !== "GET") {
    event.res.statusCode = 405;
    return { error: "Method not allowed" };
  }

  const auth = await resolveUserId(event);
  if (!auth.ok) {
    event.res.statusCode = auth.status;
    return { error: auth.error };
  }
  const db = setupDatabase();

  try {
    const boardId = Number(getQuery(event).boardId);
    if (!Number.isInteger(boardId) || boardId <= 0) {
      event.res.statusCode = 400;
      return { error: "Required fields are missing" };
    }

    const [rows]: any = await db.execute("SELECT * FROM boards WHERE id = ?", [
      boardId,
    ]);
    const board = rows[0];
    if (!board) {
      event.res.statusCode = 404;
      return { error: "Resource not found" };
    }
    const decision = await authorizeBoard(db, board, auth.userId, "read");
    if (!decision.ok) {
      event.res.statusCode = decision.status;
      return { error: decision.error };
    }

    const now = new Date();
    const folder = boardFolder(board);

    // The same board as a spreadsheet: its cards, one per row, for somebody
    // who reports on the work rather than moves it somewhere else.
    if (getQuery(event).format === "csv") {
      const config = useRuntimeConfig();
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
      version: useRuntimeConfig().appVersion ?? null,
      now,
    });
    if (!built) {
      event.res.statusCode = 404;
      return { error: "Resource not found" };
    }

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
  } catch (error) {
    logger.error("Database error:", error);
    event.res.statusCode = 500;
    return { error: "Internal server error" };
  }
});
