import { defineEventHandler, getRequestHeader, readRawBody } from "h3";
import { setupDatabase } from "../../../../app/lib/databaseSetup";
import { writeImportedBoard, type ImportBoard } from "../../../utils/boardImport";
import { deckJsonToBoards, isDeckExport } from "../../../utils/deckImport";
import { isWekanExport, wekanJsonToBoard } from "../../../utils/wekanImport";
import { isTrelloExport, trelloToImport } from "../../../utils/trelloImport";
import {
  downloadTrelloAttachment,
  trelloToken,
} from "../../../utils/trelloDownload";
import { bringTrelloFiles } from "../../../utils/trelloFiles";
import { saveContentImage } from "../../../utils/imageProcessing";

// Import boards from an export file another tool wrote.
//
// The file is the request body, as it came out of that tool. Which tool it
// came from is read from the file itself rather than asked for: a Wekan board
// export says `wekan-board` in its `_format`, a Nextcloud Deck export is a
// `version` and its `boards`, and Trello's is a board with a `shortLink` —
// the same JSON the link import reads, which is how a private Trello board
// comes in. Trello's export links its files rather than carrying them. For a
// private board Trello hands them over only to somebody signed in, so the
// person importing can send a token of theirs along, in `x-trello-token`: it
// is used for these downloads and nothing else, and kept nowhere. Whatever
// cannot be fetched stays on its card as a link.
// Each board in the file becomes a private board of the caller's. Reading each
// format lives in its own file under server/utils, tested against real
// exports in test/fixtures/import.

// A Wekan export carries its files inside it as base64, so a board with a
// handful of pictures is a few megabytes; this leaves room for a board with a
// lot of them without letting one request fill the memory.
const MAX_BODY_BYTES = 100 * 1024 * 1024;

export default defineEventHandler(async (event) => {
  const auth = await resolveUserId(event);
  if (!auth.ok) {
    event.res.statusCode = auth.status;
    return { error: auth.error };
  }

  const declared = Number(getRequestHeader(event, "content-length") || 0);
  if (declared > MAX_BODY_BYTES) {
    event.res.statusCode = 413;
    return { error: "IMPORT_TOO_LARGE" };
  }

  let json: any;
  try {
    const raw = await readRawBody(event, "utf8");
    if (!raw || raw.length > MAX_BODY_BYTES) {
      event.res.statusCode = raw ? 413 : 400;
      return { error: raw ? "IMPORT_TOO_LARGE" : "IMPORT_UNKNOWN_FORMAT" };
    }
    json = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    event.res.statusCode = 400;
    return { error: "IMPORT_UNKNOWN_FORMAT" };
  }

  let boards: ImportBoard[] | null = null;
  let source = "";
  if (isTrelloExport(json)) {
    const board = trelloToImport(json);
    if (board) {
      const key = String(useRuntimeConfig().public.trelloApiKey || "");
      const token = trelloToken(getRequestHeader(event, "x-trello-token"));
      const auth = key && token ? { key, token } : null;
      await bringTrelloFiles(board, {
        download: (file) => downloadTrelloAttachment(file, auth),
        saveImage: saveContentImage,
      });
    }
    boards = board ? [board] : null;
    source = "trello";
  } else if (isWekanExport(json)) {
    const board = wekanJsonToBoard(json);
    boards = board ? [board] : null;
    source = "wekan";
  } else if (isDeckExport(json)) {
    boards = deckJsonToBoards(json);
    source = "deck";
  }
  if (!boards) {
    event.res.statusCode = 400;
    return { error: "IMPORT_UNKNOWN_FORMAT" };
  }
  if (!boards.length || boards.every((board) => !board.areas.length)) {
    event.res.statusCode = 400;
    return { error: "IMPORT_EMPTY" };
  }

  const db = setupDatabase();
  const created: Array<{ id: number; name: string }> = [];
  let files = 0;
  let linked = 0;
  try {
    for (const board of boards) {
      const written = await writeImportedBoard(db, auth.userId, board, {
        language: useRuntimeConfig().language,
      });
      created.push({ id: written.boardId, name: board.name });
      files += written.files;
      linked += written.linked;
    }
  } catch (error) {
    logger.error("Board import failed:", error);
    event.res.statusCode = 500;
    return { error: "IMPORT_FAILED", boards: created };
  }

  return { success: true, source, boards: created, files, linked };
});
