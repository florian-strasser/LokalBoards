import { defineEventHandler, getQuery } from "h3";
import { setupDatabase } from "../../../app/lib/databaseSetup";

// What the signed-in person has connected, and how to disconnect it.
//
// One row per application rather than per token: somebody who connected ChatGPT
// wants to see "ChatGPT", not the four access tokens it has rotated through
// since. Disconnecting revokes every token it holds and forgets the consent, so
// the next attempt asks again from the beginning.
export default defineEventHandler(async (event) => {
  const session = await resolveSession(event);
  if (session.status !== "ok") {
    event.res.statusCode = 401;
    return { error: "Unauthorized" };
  }
  const userId = session.user.id;
  const db = setupDatabase();

  if (event.req.method === "GET") {
    const [rows]: any = await db.execute(
      `SELECT co.\`clientId\`, co.\`scope\`, co.\`createdAt\`,
              cl.\`name\`, cl.\`uri\`, cl.\`registration\`,
              (SELECT MAX(t.\`lastUsedAt\`) FROM \`oauth_tokens\` t
                WHERE t.\`clientId\` = co.\`clientId\` AND t.\`userId\` = co.\`userId\`) AS lastUsedAt,
              (SELECT COUNT(*) FROM \`oauth_tokens\` t
                WHERE t.\`clientId\` = co.\`clientId\` AND t.\`userId\` = co.\`userId\`
                  AND t.\`revokedAt\` IS NULL AND t.\`expiresAt\` > NOW()) AS liveTokens
         FROM \`oauth_consents\` co
         LEFT JOIN \`oauth_clients\` cl ON cl.\`id\` = co.\`clientId\`
        WHERE co.\`userId\` = ?
        ORDER BY co.\`createdAt\` DESC`,
      [userId],
    );
    return {
      connections: (rows as any[]).map((row) => ({
        clientId: row.clientId,
        name: row.name || row.clientId,
        uri: row.uri,
        scope: row.scope,
        connectedAt: row.createdAt,
        lastUsedAt: row.lastUsedAt,
        active: Number(row.liveTokens) > 0,
      })),
    };
  }

  if (event.req.method === "DELETE") {
    const clientId = String(getQuery(event).clientId || "");
    if (!clientId) {
      event.res.statusCode = 400;
      return { error: "Required fields are missing" };
    }
    await db.execute(
      "UPDATE `oauth_tokens` SET `revokedAt` = NOW() WHERE `userId` = ? AND `clientId` = ? AND `revokedAt` IS NULL",
      [userId, clientId],
    );
    await db.execute(
      "DELETE FROM `oauth_consents` WHERE `userId` = ? AND `clientId` = ?",
      [userId, clientId],
    );
    return { success: true };
  }

  event.res.statusCode = 405;
  return { error: "Method not allowed" };
});
