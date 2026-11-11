import { onlyOneAdminLeft } from "../../../utils/auth";
import {
  dummyPasswordCheck,
  isEmail,
  isPasswordLongEnough,
  setLocalPassword,
} from "../../../utils/password";

export default authHandler("POST", "admin", async ({ event, db }) => {
  const { userId, name, email, password, role, type, emailNotifications } =
    await readBody(event);

  if (type !== undefined && type !== "human" && type !== "artificial") {
    fail(400, "INVALID_TYPE");
  }

  // Each field is optional; one that is given is held to the same rules, and
  // the same length limits, as when the account was created.
  if (!isStoredId(userId)) fail(400, "INVALID_USER_ID");
  if (
    name &&
    (typeof name !== "string" || name.trim() === "" || name.length > 255)
  ) {
    fail(400, "INVALID_NAME");
  }
  if (email && (!isEmail(email) || email.length > 255)) {
    fail(400, "INVALID_EMAIL");
  }
  if (password && (!isPasswordLongEnough(password) || password.length > 255)) {
    fail(400, "INVALID_PASSWORD");
  }
  if (role && role !== "user" && role !== "admin") fail(400, "INVALID_ROLE");

  const [users] = await db.execute("SELECT * FROM `user` WHERE `id` = ?", [
    userId,
  ]);
  if (users.length === 0) {
    // The same cost as an update that sets a password.
    await dummyPasswordCheck(password || userId);
    fail(404, "USER_NOT_FOUND");
  }
  const user = users[0];

  // One transaction, so a refusal part-way leaves the account as it was.
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const updateFields = [];
    const updateValues = [];

    if (name && name !== user.name) {
      updateFields.push("`name` = ?");
      updateValues.push(name.trim());
    }

    if (email && email !== user.email) {
      const [existingUsers] = await conn.execute(
        "SELECT * FROM `user` WHERE `email` = ? AND `id` != ?",
        [email, userId],
      );
      if (existingUsers.length > 0) {
        await dummyPasswordCheck(email);
        fail(400, "EMAIL_ALREADY_TAKEN");
      }

      updateFields.push("`email` = ?");
      updateValues.push(email);

      // A reset link already mailed to the old address must not outlive the
      // change: once the address is free, somebody else can sign up with it,
      // and the link names the account by address.
      await conn.execute(
        "DELETE FROM `verification` WHERE `identifier` = ?",
        [user.email],
      );
    }

    if (role && role !== user.role) {
      // Don't allow demoting the last remaining admin — an instance must keep
      // at least one admin.
      if (
        user.role === "admin" &&
        role === "user" &&
        (await onlyOneAdminLeft(conn))
      ) {
        fail(400, "LAST_ADMIN");
      }
      updateFields.push("`role` = ?");
      updateValues.push(role);
    }

    // Human vs artificial (AI agent) account.
    if (type && type !== user.type) {
      updateFields.push("`type` = ?");
      updateValues.push(type);
    }

    // Whether this account receives notification e-mails.
    if (emailNotifications !== undefined) {
      updateFields.push("`emailNotifications` = ?");
      updateValues.push(emailNotifications ? 1 : 0);
    }

    if (updateFields.length > 0) {
      updateValues.push(userId);
      await conn.execute(
        `UPDATE \`user\` SET ${updateFields.join(", ")}, \`updatedAt\` = CURRENT_TIMESTAMP(3) WHERE \`id\` = ?`,
        updateValues,
      );
    }

    // The local sign-in's password, made if the account had none — an account
    // that came through SSO gets a password only because an administrator set
    // one. Its SSO sign-ins are left as they are.
    if (password) {
      await setLocalPassword(conn, userId, password, { create: true });
    }

    await conn.commit();
  } catch (error: any) {
    // Including the refusals above, which leave the same way.
    await conn.rollback();
    // The address was taken between the check above and the update.
    if (error?.code === "ER_DUP_ENTRY") fail(400, "EMAIL_ALREADY_TAKEN");
    throw error;
  } finally {
    conn.release();
  }

  const [updatedUsers] = await db.execute(
    "SELECT id, name, email, role, createdAt, updatedAt FROM `user` WHERE `id` = ?",
    [userId],
  );

  return {
    success: true,
    message: "USER_UPDATED_SUCCESSFULLY",
    user: updatedUsers[0],
  };
});
