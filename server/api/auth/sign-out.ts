import { deleteCookie } from "h3";
import { hashToken, sessionTokenOf } from "../../utils/auth";

export default authHandler("POST", "anyone", async ({ event, db }) => {
  const sessionToken = sessionTokenOf(event);
  if (
    !sessionToken ||
    typeof sessionToken !== "string" ||
    sessionToken.length < 10
  ) {
    fail(400, "Logout failed");
  }

  // Sessions are stored by their token's hash.
  const [result] = await db.execute("DELETE FROM `session` WHERE `token` = ?", [
    hashToken(sessionToken),
  ]);

  // Signed out means a session was there to end.
  if (result.affectedRows === 0) fail(400, "Logout failed");

  deleteCookie(event, "session_token", {
    path: "/",
  });

  return {
    success: true,
    message: "Successfully logged out",
  };
});
