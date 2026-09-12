import { defineEventHandler, readBody } from "h3";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { hashSecret } from "../../utils/oauth";

// RFC 7009. Hands back 200 whatever happens, as the RFC requires: telling an
// unauthenticated caller whether a token existed is itself a disclosure, and a
// client revoking something already gone should not have to care.
export default defineEventHandler(async (event) => {
  if (event.req.method !== "POST") {
    event.res.statusCode = 405;
    return { error: "invalid_request" };
  }

  const body: any = (await readBody(event).catch(() => null)) ?? {};
  const token = String(body.token || "");
  if (token) {
    const hash = hashSecret(token);
    const db = setupDatabase();
    // Either half of the pair revokes the whole grant: a client revoking its
    // refresh token does not expect its access token to keep working.
    await db.execute(
      "UPDATE `oauth_tokens` SET `revokedAt` = NOW() WHERE (`accessHash` = ? OR `refreshHash` = ?) AND `revokedAt` IS NULL",
      [hash, hash],
    );
  }
  return {};
});
