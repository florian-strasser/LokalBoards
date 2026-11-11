import { readBody } from "h3";

// The caller's own board groups. Every operation is scoped to the caller, so a
// user can only ever see and change their own groups — including for boards
// shared with them.
//
//   GET    → list the caller's groups (ordered)
//   POST   → create a group { name } at the end
//   PATCH  → update the caller's group { id, name?, collapsed? }
//   DELETE → remove the caller's group { id }; its boards fall back to ungrouped

const NAME_MAX = 255;

// A group's name as sent, or a 400.
function nameFrom(value: unknown): string {
  const name = String(value ?? "").trim();
  if (!name || name.length > NAME_MAX) fail(400, "INVALID_NAME");
  return name;
}

// The id of one of the caller's groups as sent, or a 400.
function idFrom(body: any): number {
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) fail(400, "INVALID_ID");
  return id;
}

export default dataHandler({
  async GET({ db, userId }) {
    const [rows]: any = await db.execute(
      "SELECT id, name, sort, collapsed FROM `board_groups` WHERE `user` = ? ORDER BY sort, id",
      [userId],
    );
    return {
      groups: rows.map((group: any) => ({
        id: group.id,
        name: group.name,
        sort: group.sort,
        collapsed: !!group.collapsed,
      })),
    };
  },

  async POST({ event, db, userId }) {
    const body = await readBody(event).catch(() => null);
    const name = nameFrom(body?.name);
    // Appended after the caller's existing groups.
    const [[max]]: any = await db.query(
      "SELECT COALESCE(MAX(sort), -1) + 1 AS nextSort FROM `board_groups` WHERE `user` = ?",
      [userId],
    );
    const [result]: any = await db.execute(
      "INSERT INTO `board_groups` (`user`, `name`, `sort`) VALUES (?, ?, ?)",
      [userId, name, max.nextSort],
    );
    return {
      group: { id: result.insertId, name, sort: max.nextSort, collapsed: false },
    };
  },

  async PATCH({ event, db, userId }) {
    const body = await readBody(event).catch(() => null);
    const id = idFrom(body);
    const fields: string[] = [];
    const values: any[] = [];
    if (body.name !== undefined) {
      fields.push("name = ?");
      values.push(nameFrom(body.name));
    }
    if (body.collapsed !== undefined) {
      fields.push("collapsed = ?");
      values.push(body.collapsed ? 1 : 0);
    }
    if (fields.length === 0) fail(400, "NOTHING_TO_UPDATE");
    // The `user = ?` clause makes this the ownership check.
    const [result]: any = await db.execute(
      `UPDATE \`board_groups\` SET ${fields.join(", ")} WHERE id = ? AND \`user\` = ?`,
      [...values, id, userId],
    );
    if (!result.affectedRows) fail(404, "NOT_FOUND");
    return { ok: true };
  },

  async DELETE({ event, db, userId }) {
    const id = idFrom(await readBody(event).catch(() => null));
    const [result]: any = await db.execute(
      "DELETE FROM `board_groups` WHERE id = ? AND `user` = ?",
      [id, userId],
    );
    if (!result.affectedRows) fail(404, "NOT_FOUND");
    // The group's boards aren't lost — they drop back to ungrouped.
    await db.execute(
      "UPDATE `board_placements` SET `group` = NULL WHERE `group` = ? AND `user` = ?",
      [id, userId],
    );
    return { ok: true };
  },
});
