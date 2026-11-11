import { v4 as uuidv4 } from "uuid";

export default authHandler("POST", "user", async ({ event, db, session }) => {
  const { name, expiresIn, readOnly } = await readBody(event);

  if (
    !name ||
    typeof name !== "string" ||
    name.trim() === "" ||
    name.length > 255
  ) {
    fail(400, "INVALID_NAME");
  }

  // Seconds from now, at most a year (365 * 24 * 60 * 60); none means never.
  if (expiresIn !== undefined && expiresIn !== null) {
    if (
      typeof expiresIn !== "number" ||
      expiresIn <= 0 ||
      expiresIn > 31536000
    ) {
      fail(400, "INVALID_EXPIRES_IN");
    }
  }

  // Generate API key (32 character random string)
  const apiKey = uuidv4().replace(/-/g, "").substring(0, 32);
  const keyId = uuidv4();
  const keyStart = apiKey.substring(0, 8); // First 8 characters for display

  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;

  // A read-only key is scoped to ["read"]; a full key stores no scopes (null =
  // unrestricted). The MCP layer rejects write tools when "write" is absent.
  const permissions = readOnly ? JSON.stringify(["read"]) : null;

  // Store only the SHA-256 hash of the key, never the plaintext, so a database
  // leak can't expose usable keys. `start` keeps the first 8 chars for display.
  await db.execute(
    "INSERT INTO `apikey` (`id`, `name`, `start`, `key`, `expiresAt`, `referenceId`, `permissions`) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      keyId,
      name.trim(),
      keyStart,
      hashApiKey(apiKey),
      expiresAt,
      session.user.id, // referenceId stores the userId
      permissions,
    ],
  );

  // Return the plaintext key this one time only — it cannot be recovered later
  // (the database stores just the hash).
  return {
    success: true,
    message: "API_KEY_CREATED_SUCCESSFULLY",
    id: keyId,
    name: name.trim(),
    key: apiKey,
    start: keyStart,
    expiresAt: expiresAt,
  };
});
