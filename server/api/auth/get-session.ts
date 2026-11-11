export default authHandler("GET", "anyone", async ({ event }) => {
  const result = await resolveSession(event);

  // Don't leak ban details.
  if (result.status === "banned") fail(403, "Access denied");
  if (result.status !== "ok") fail(401, "Session validation failed");

  // Never return the session token to the client.
  return {
    data: {
      session: result.session,
      user: result.user,
    },
  };
});
