import { createReadStream, promises as fs } from "node:fs";
import { basename, normalize } from "node:path";
import { createError, defineEventHandler, getRouterParams } from "h3";
import { getFileExtension, getMimeType, showsInTab, uploadedFile } from "../../utils/fileUtils";

// An uploaded file, by the name the server gave it. No sign-in: the name is
// random and long enough that knowing it is the permission.
export default defineEventHandler(async (event) => {
  try {
    const { path } = getRouterParams(event);
    if (!path) {
      throw createError({
        statusCode: 400,
        statusMessage: "Invalid request",
      });
    }

    // A leading `../` is dropped rather than refused, and whatever is left has
    // to be inside the folder.
    const fullPath = uploadedFile(normalize(path).replace(/^(\.\.(\/|\\|$))+/, ""));
    if (!fullPath) {
      throw createError({
        statusCode: 403,
        statusMessage: "Invalid request",
      });
    }

    const stats = await fs.stat(fullPath).catch(() => null);
    if (!stats) {
      throw createError({
        statusCode: 404,
        statusMessage: "Resource not found",
      });
    }
    if (!stats.isFile()) {
      throw createError({
        statusCode: 400,
        statusMessage: "Invalid request",
      });
    }

    // Shown in the tab only if it is a picture or a PDF, saved otherwise: see
    // `showsInTab`. Every file here proved its type when it was uploaded, and
    // this holds for one that came some other way all the same.
    const type = getMimeType(getFileExtension(fullPath));
    event.node.res.setHeader("Content-Type", type);
    event.node.res.setHeader("X-Content-Type-Options", "nosniff");
    event.node.res.setHeader("Content-Length", stats.size);
    // The stored name, never the one it was uploaded under: that is the
    // attachment's to give (see /api/data/attachment).
    event.node.res.setHeader(
      "Content-Disposition",
      `${showsInTab(type) ? "inline" : "attachment"}; filename="${basename(fullPath)}"`,
    );
    // A name is never given to other content, so the browser keeps the file for
    // a year. Only the browser: a CDN or proxy in front must not, or a file
    // taken off its card would go on being handed out from there.
    event.node.res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    return createReadStream(fullPath);
  } catch (error: any) {
    if (error?.statusCode) throw error;
    logger.error("File download error:", error);
    throw createError({
      statusCode: 500,
      statusMessage: "Download failed",
    });
  }
});
