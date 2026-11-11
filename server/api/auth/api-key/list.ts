export default authHandler("GET", "user", async ({ db, session }) => {
  const [keys] = await db.execute(
    "SELECT id, name, `start`, expiresAt FROM `apikey` WHERE `referenceId` = ? ORDER BY createdAt DESC",
    [session.user.id],
  );

  return {
    success: true,
    apiKeys: keys.map((key: any) => ({
      id: key.id,
      name: key.name,
      start: key.start,
      expiresAt: key.expiresAt,
    })),
  };
});
