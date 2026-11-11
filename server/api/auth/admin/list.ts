export default authHandler("GET", "admin", async ({ db }) => {
  const [users] = await db.execute(
    "SELECT id, name, email, image, role, type, emailNotifications, createdAt, updatedAt FROM `user` ORDER BY createdAt DESC",
  );

  return {
    success: true,
    users: users.map((user: any) => ({
      id: user.id,
      username: user.name,
      email: user.email,
      image: user.image,
      role: user.role,
      type: user.type || "human",
      emailNotifications: !!user.emailNotifications,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    })),
  };
});
