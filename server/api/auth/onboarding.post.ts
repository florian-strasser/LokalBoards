// POST /api/auth/onboarding — mark the current user as onboarded, so the
// first-run guided tour is not offered again (called when the tour is started,
// completed or skipped).
export default authHandler("POST", "user", async ({ db, session }) => {
  await db.execute("UPDATE `user` SET `onboarded` = 1 WHERE `id` = ?", [
    session.user.id,
  ]);
  return { success: true };
});
