import { dummyPasswordCheck } from "../../../utils/password";

export default authHandler("POST", "user", async ({ event, db, session }) => {
  const { keyId } = await readBody(event);
  if (!isStoredId(keyId)) fail(400, "INVALID_KEY_ID");

  // Only the caller's own key: one that is somebody else's is as missing as
  // one that does not exist.
  const [result] = await db.execute(
    "DELETE FROM `apikey` WHERE `id` = ? AND `referenceId` = ?",
    [keyId, session.user.id],
  );
  if (result.affectedRows === 0) {
    await dummyPasswordCheck(keyId);
    fail(404, "API_KEY_NOT_FOUND");
  }

  return {
    success: true,
    message: "API_KEY_DELETED_SUCCESSFULLY",
  };
});
