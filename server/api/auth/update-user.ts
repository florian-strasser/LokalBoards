import { onlyOneAdminLeft } from "../../utils/auth";

export default authHandler("POST", "user", async ({ event, db, session }) => {
  const { name, image, role, emailNotifications } = await readBody(event);

  if (!name || typeof name !== "string" || name.trim() === "") {
    fail(400, "Invalid input");
  }

  // The picture: an http(s) URL, an image data URI or a path on this instance.
  if (image && typeof image === "string") {
    const lowerImage = image.trim().toLowerCase();
    // Never a scheme that runs script where the picture is shown.
    if (
      lowerImage.startsWith("javascript:") ||
      lowerImage.startsWith("vbscript:") ||
      (lowerImage.startsWith("data:") && !lowerImage.startsWith("data:image/"))
    ) {
      fail(400, "Invalid input");
    }
    const isUrl = image.startsWith("http://") || image.startsWith("https://");
    const isBase64 = image.startsWith("data:image/");
    const isRelativePath =
      image.startsWith("/") || image.startsWith("./") || image.startsWith("../");
    if (!isUrl && !isBase64 && !isRelativePath) fail(400, "Invalid input");
    // A data URI is stored inline, so its size is capped.
    if (image.length > 1000000) fail(400, "Invalid input");
  }

  // Optional self role change. Only an admin may change their own role (this
  // is the "demote myself to a normal user" case) — a normal user changing
  // their own role would be privilege escalation, so it's rejected. Demoting
  // the last admin is blocked so an instance can't end up with no admins.
  const fields = ["`name` = ?", "`image` = ?"];
  const values: any[] = [name.trim(), image || null];
  if (role !== undefined && role !== session.user.role) {
    if (session.user.role !== "admin") fail(403, "Forbidden");
    if (role !== "user" && role !== "admin") fail(400, "Invalid input");
    if (role === "user" && (await onlyOneAdminLeft(db))) {
      fail(400, "LAST_ADMIN");
    }
    fields.push("`role` = ?");
    values.push(role);
  }

  // Let a user turn notification e-mails off (or back on) for themselves.
  if (emailNotifications !== undefined) {
    fields.push("`emailNotifications` = ?");
    values.push(emailNotifications ? 1 : 0);
  }
  values.push(session.user.id);

  await db.execute(
    `UPDATE \`user\` SET ${fields.join(", ")}, \`updatedAt\` = CURRENT_TIMESTAMP(3) WHERE \`id\` = ?`,
    values,
  );

  const [users] = await db.execute(
    "SELECT id, name, email, role, image, displayUsername FROM `user` WHERE `id` = ?",
    [session.user.id],
  );
  // Only if the account was deleted in the moment since the session was read.
  if (users.length === 0) fail(404, "Resource not found");

  return {
    success: true,
    message: "User updated successfully",
    user: users[0],
  };
});
