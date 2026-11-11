import { readBody } from "h3";
import { parseTrelloShortLink, trelloToImport } from "../../../utils/trelloImport";
import { writeImportedBoard } from "../../../utils/boardImport";
import { downloadTrelloAttachment } from "../../../utils/trelloDownload";
import { bringTrelloFiles } from "../../../utils/trelloFiles";
import { saveContentImage } from "../../../utils/imageProcessing";

// Import a whole board from Trello by its public share link. Trello exposes any
// *public* board as JSON at `https://trello.com/b/<shortLink>.json`; we fetch
// that (never an arbitrary user-supplied URL — only a trello.com URL derived
// from the shortLink, so this can't be used for SSRF) and recreate the board,
// its lists (areas), cards (name + description + checklists + labels + due
// date + status + comments) and uploaded attachments locally. Parsing lives in
// server/utils/trelloImport.ts (unit-tested); a private board comes in through
// its exported file instead, see ./file.post.ts.

export default dataHandler({
  async POST({ event, db, userId }) {
    const { url } = (await readBody(event).catch(() => null)) || {};
    const shortLink = parseTrelloShortLink(url);
    if (!shortLink) fail(400, "TRELLO_INVALID_URL");

    // Fetch the board JSON from Trello. Only *public* boards are readable this
    // way — a private (or missing) board 302-redirects to login. `redirect:
    // "manual"` means we treat any non-200 as "not accessible" and never follow a
    // redirect to another host (SSRF hardening).
    let trello: any = null;
    try {
      const res = await fetch(`https://trello.com/b/${shortLink}.json`, {
        redirect: "manual",
        headers: {
          accept: "application/json",
          "user-agent": "LokalBoards board importer",
        },
        signal: AbortSignal.timeout(20000),
      });
      const contentType = res.headers.get("content-type") || "";
      if (res.status === 200 && contentType.includes("json")) {
        trello = await res.json();
      } else {
        logger.error("Trello import: not accessible (status", res.status + ")");
      }
    } catch (err: any) {
      logger.error("Trello import fetch failed:", err);
    }

    const structure = trello && trelloToImport(trello);
    if (!structure) fail(400, "TRELLO_NOT_ACCESSIBLE");
    if (structure.areas.length === 0) fail(400, "TRELLO_EMPTY");

    // The files first — a public board's are open to anybody — with the
    // pictures in its text stored here instead of linked to Trello; then the
    // board, written the way every import is (see `boardImport.ts`).
    let written;
    try {
      await bringTrelloFiles(structure, {
        download: (file) => downloadTrelloAttachment(file),
        saveImage: saveContentImage,
      });
      written = await writeImportedBoard(db, userId, structure, {
        language: useRuntimeConfig().language,
      });
    } catch (error) {
      logger.error("Trello import failed:", error);
      fail(500, "TRELLO_IMPORT_FAILED");
    }

    const [rows]: any = await db.execute("SELECT * FROM boards WHERE id = ?", [
      written.boardId,
    ]);
    return { success: true, board: rows[0] };
  },
});
