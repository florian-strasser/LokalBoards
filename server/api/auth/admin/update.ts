import { setupDatabase } from "../../../../app/lib/databaseSetup";
import { getUserSession } from "../../../utils/auth";
import { dummyPasswordCheck } from "../../../utils/password";
import bcrypt from "bcryptjs";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default defineEventHandler(async (event) => {
  const method = event.req.method;
  if (method !== "POST") {
    event.res.statusCode = 405;
    return { error: "Method not allowed" };
  }

  try {
    // Verify session and admin role
    const session = await getUserSession(event);
    if (!session) {
      event.res.statusCode = 401;
      return { error: "UNAUTHORIZED" };
    }

    if (session.user.role !== "admin") {
      event.res.statusCode = 403;
      return { error: "FORBIDDEN" };
    }

    const body = await readBody(event);
    const { userId, name, email, password, role, type, emailNotifications } =
      body;

    if (type !== undefined && type !== "human" && type !== "artificial") {
      event.res.statusCode = 400;
      return { error: "INVALID_TYPE" };
    }

    // Validate input with length limits
    // MEDIUM FIX: Validate userId is UUID format
    if (!isStoredId(userId)) {
      event.res.statusCode = 400;
      return { error: "INVALID_USER_ID" };
    }

    if (
      name &&
      (typeof name !== "string" || name.trim() === "" || name.length > 255)
    ) {
      event.res.statusCode = 400;
      return { error: "INVALID_NAME" };
    }

    // MEDIUM FIX: Strong email validation
    if (
      email &&
      (typeof email !== "string" ||
        !emailRegex.test(email) ||
        email.length > 255)
    ) {
      event.res.statusCode = 400;
      return { error: "INVALID_EMAIL" };
    }

    if (
      password &&
      (typeof password !== "string" ||
        password.length < 8 ||
        password.length > 255)
    ) {
      event.res.statusCode = 400;
      return { error: "INVALID_PASSWORD" };
    }

    if (role && role !== "user" && role !== "admin") {
      event.res.statusCode = 400;
      return { error: "INVALID_ROLE" };
    }

    const db = await setupDatabase();

    // HIGH FIX: Use constant-time check for user existence
    const [users] = await db.execute("SELECT * FROM `user` WHERE `id` = ?", [
      userId,
    ]);

    const userExists = users.length > 0;

    if (!userExists) {
      // The same cost as an update that sets a password.
      await dummyPasswordCheck(password || userId);
      event.res.statusCode = 404;
      return { error: "USER_NOT_FOUND" };
    }

    const user = users[0];

    // Use transaction for atomic updates
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      // Update user data
      const updateFields = [];
      const updateValues = [];

      if (name && name !== user.name) {
        updateFields.push("`name` = ?");
        updateValues.push(name.trim());
      }

      if (email && email !== user.email) {
        // HIGH FIX: Use constant-time check for email availability
        const [existingUsers] = await conn.execute(
          "SELECT * FROM `user` WHERE `email` = ? AND `id` != ?",
          [email, userId],
        );

        const emailExists = existingUsers.length > 0;

        if (emailExists) {
          await dummyPasswordCheck(email);
          await conn.rollback();
          event.res.statusCode = 400;
          return { error: "EMAIL_ALREADY_TAKEN" };
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
        if (user.role === "admin" && role === "user") {
          const [adminRows]: any = await conn.execute(
            "SELECT COUNT(*) AS c FROM `user` WHERE `role` = 'admin'",
          );
          if ((adminRows[0]?.c ?? 0) <= 1) {
            await conn.rollback();
            event.res.statusCode = 400;
            return { error: "LAST_ADMIN" };
          }
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

      // Update user record if there are changes
      if (updateFields.length > 0) {
        updateValues.push(userId);
        await conn.execute(
          `UPDATE \`user\` SET ${updateFields.join(", ")}, \`updatedAt\` = CURRENT_TIMESTAMP(3) WHERE \`id\` = ?`,
          updateValues,
        );
      }

      // Update password if provided
      if (password) {
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        await conn.execute(
          "UPDATE `account` SET `password` = ?, `updatedAt` = CURRENT_TIMESTAMP(3) WHERE `userId` = ?",
          [hashedPassword, userId],
        );
      }

      await conn.commit();
    } catch (error: any) {
      await conn.rollback();
      // The address was taken between the check above and the update.
      if (error?.code === "ER_DUP_ENTRY") {
        event.res.statusCode = 400;
        return { error: "EMAIL_ALREADY_TAKEN" };
      }
      throw error;
    } finally {
      conn.release();
    }

    // Get updated user data
    const [updatedUsers] = await db.execute(
      "SELECT id, name, email, role, createdAt, updatedAt FROM `user` WHERE `id` = ?",
      [userId],
    );

    return {
      success: true,
      message: "USER_UPDATED_SUCCESSFULLY",
      user: updatedUsers[0],
    };
  } catch (error) {
    logger.error("Update user error:", error);
    event.res.statusCode = 500;
    return { error: "INTERNAL_SERVER_ERROR" };
  }
});
