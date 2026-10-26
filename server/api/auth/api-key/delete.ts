import { setupDatabase } from "../../../../app/lib/databaseSetup";
import { getUserSession } from "../../../utils/auth";
import { dummyPasswordCheck } from "../../../utils/password";

export default defineEventHandler(async (event) => {
  const method = event.req.method;
  if (method !== "POST") {
    event.res.statusCode = 405;
    return { error: "Method not allowed" };
  }

  try {
    // Verify session first
    const session = await getUserSession(event);
    if (!session) {
      event.res.statusCode = 401;
      return { error: "UNAUTHORIZED" };
    }

    const body = await readBody(event);
    const { keyId } = body;

    // Validate input - UUID format
    if (!isStoredId(keyId)) {
      event.res.statusCode = 400;
      return { error: "INVALID_KEY_ID" };
    }

    const db = await setupDatabase();

    // First, verify the key belongs to the current user
    // Use constant-time check to prevent timing attacks
    const [keys] = await db.execute(
      "SELECT id FROM `apikey` WHERE `id` = ? AND `referenceId` = ?",
      [keyId, session.user.id],
    );

    const keyExists = keys.length > 0;

    if (!keyExists) {
      await dummyPasswordCheck(keyId);
      event.res.statusCode = 404;
      return { error: "API_KEY_NOT_FOUND" };
    }

    // Delete the API key
    await db.execute("DELETE FROM `apikey` WHERE `id` = ?", [keyId]);

    return {
      success: true,
      message: "API_KEY_DELETED_SUCCESSFULLY",
    };
  } catch (error) {
    logger.error("Delete API key error:", error);
    event.res.statusCode = 500;
    return { error: "INTERNAL_SERVER_ERROR" };
  }
});
