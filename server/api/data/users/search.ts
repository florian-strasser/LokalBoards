// Partially mask an email so same-name users can be told apart in the picker
// without exposing the full address, e.g. "florian@example.com" -> "fl••@exa••.com".
function maskEmail(email: unknown): string {
  if (typeof email !== "string") return "";
  const at = email.indexOf("@");
  if (at < 1) return "";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const domainName = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : "";
  const mask = (s: string, keep: number) =>
    (s.length > keep ? s.slice(0, keep) : s.slice(0, 1)) + "••";
  return `${mask(local, 2)}@${mask(domainName, 3)}${tld}`;
}

// GET /api/data/users/search?boardId=123&q=ali
//
// Returns users the board owner can invite, matched by name OR email, for the
// invite picker. Deliberately returns only id/name/image — never the email —
// so the directory can be searched without harvesting email addresses. The
// board owner (and only the owner) may search, mirroring who can invite.
export default dataHandler({
  async GET({ db, query, userId }) {
    const boardId = positiveId(query.boardId, "Invalid board ID");
    const q = typeof query.q === "string" ? query.q.trim() : "";

    const [boards]: any = await db.execute("SELECT user FROM boards WHERE id = ?", [boardId]);
    if (!boards[0]) fail(404, "Resource not found");
    if (boards[0].user !== userId) fail(403, "Unauthorized access");

    // Exclude the owner and anyone already invited to this board.
    let sql =
      "SELECT id, name, image, email FROM `user` " +
      "WHERE id != ? AND id NOT IN (SELECT user FROM invitations WHERE board = ?)";
    const params: any[] = [userId, boardId];

    if (q) {
      // What was typed, literally: a `%` or `_` in it is not a wildcard.
      sql += " AND (name LIKE ? ESCAPE '\\\\' OR email LIKE ? ESCAPE '\\\\')";
      const like = `%${escapeLike(String(q))}%`;
      params.push(like, like);
    }
    sql += " ORDER BY name LIMIT 20";

    const [rows] = await db.query(sql, params);
    // Return only a masked email — the raw address never leaves the server.
    const users = (rows as any[]).map((u) => ({
      id: u.id,
      name: u.name,
      image: u.image,
      emailMasked: maskEmail(u.email),
    }));
    return { users };
  },
});
