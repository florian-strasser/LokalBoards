import { Readable } from "node:stream";
import { setHeader } from "h3";
import {
  addEntries,
  boardFolder,
  buildBoardExport,
  createZip,
  downloadDisposition,
  exportDate,
} from "../../utils/boardExport";
import { sqlDump } from "../../utils/sqlDump";

// Everything on the instance, as one zip, for its administrators.
//
//   boards/<id>-<name>.json          every board, archived ones included
//   attachments/<id>-<name>/…        the files each board's cards hold
//   database.sql                     the whole database, restorable
//
// The JSON is for reading and for taking somewhere else; the SQL is for putting
// this instance back exactly as it was. They are in one download because the
// moment somebody wants one of them is usually the moment they want both.
//
// An API key works as well as a session, so a nightly job can fetch this — it
// acts as the account that issued the key, and that account has to be an
// administrator.

export default dataHandler({
  async GET({ event, db, userId }) {
    const [users]: any = await db.execute(
      "SELECT `role` FROM `user` WHERE `id` = ?",
      [userId],
    );
    if (users[0]?.role !== "admin") fail(403, "FORBIDDEN");

    const [boards]: any = await db.execute(
      "SELECT `id`, `name` FROM `boards` ORDER BY `id`",
    );

    const now = new Date();
    const version = useRuntimeConfig().appVersion ?? null;
    const archive = createZip();
    archive.on("warning", (error: any) =>
      logger.warn("Export:", error?.message),
    );
    archive.on("error", (error: any) => {
      logger.error("Export failed:", error?.message);
      event.node.res.destroy();
    });

    // Filled while it is being sent. An instance with a few hundred boards
    // would otherwise sit silent until every one of them had been read, and
    // the browser would give up on a download that had not started.
    (async () => {
      for (const board of boards as any[]) {
        const folder = boardFolder(board);
        const built = await buildBoardExport(db, board.id, {
          filesAt: `attachments/${folder}/`,
          version,
          now,
        });
        // Deleted since the list was read.
        if (!built) continue;
        archive.append(JSON.stringify(built.json, null, 2), {
          name: `boards/${folder}.json`,
        });
        addEntries(archive, built.entries);
      }
      archive.append(Readable.from(sqlDump(db, { version, now })), {
        name: "database.sql",
      });
      await archive.finalize();
    })().catch((error) => {
      logger.error("Export failed:", error?.message);
      archive.abort();
      event.node.res.destroy();
    });

    setHeader(event, "content-type", "application/zip");
    setHeader(
      event,
      "content-disposition",
      downloadDisposition(`lokalboards-export-${exportDate(now)}.zip`),
    );
    setHeader(event, "cache-control", "no-store");
    return archive;
  },
});
