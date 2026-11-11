import { readBody } from "h3";
import {
  accessibleBoardIds,
  ownGroupIds,
} from "../../utils/dashboardArrangement";

// Persist the caller's whole dashboard arrangement in one call. The client sends
// the full picture after any drag, and this upserts it idempotently:
//
//   { placements: [{ boardId, groupId|null, sort }], groupOrder?: [groupId, …] }
//
// Every boardId must be one the caller can access, and every groupId one of the
// caller's own groups — anything else is rejected, so the arrangement can never
// reference another user's boards or groups.
export default dataHandler({
  async POST({ event, db, userId }) {
    const body = await readBody(event).catch(() => null);
    if (!body || typeof body !== "object") fail(400, "INVALID_BODY");

    const placements = Array.isArray(body.placements) ? body.placements : [];
    const groupOrder = Array.isArray(body.groupOrder) ? body.groupOrder : null;

    const [allowedBoards, allowedGroups] = await Promise.all([
      accessibleBoardIds(db, userId),
      ownGroupIds(db, userId),
    ]);

    // Validate before writing anything, so one bad entry rejects the whole
    // request rather than leaving a half-applied arrangement.
    for (const placement of placements) {
      if (!allowedBoards.has(Number(placement?.boardId))) {
        fail(403, "FORBIDDEN_BOARD", { boardId: placement?.boardId });
      }
      const groupId = placement.groupId;
      if (groupId !== null && groupId !== undefined && !allowedGroups.has(Number(groupId))) {
        fail(403, "FORBIDDEN_GROUP", { groupId });
      }
    }
    for (const groupId of groupOrder ?? []) {
      if (!allowedGroups.has(Number(groupId))) {
        fail(403, "FORBIDDEN_GROUP", { groupId });
      }
    }

    // Upsert placements. The unique (user, board) key makes this idempotent —
    // re-sending the same arrangement is a no-op.
    for (const placement of placements) {
      const groupId =
        placement.groupId === null || placement.groupId === undefined
          ? null
          : Number(placement.groupId);
      const sort = Number.isFinite(Number(placement.sort)) ? Number(placement.sort) : 0;
      await db.execute(
        `INSERT INTO \`board_placements\` (\`user\`, \`board\`, \`group\`, \`sort\`)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE \`group\` = VALUES(\`group\`), \`sort\` = VALUES(\`sort\`)`,
        [userId, Number(placement.boardId), groupId, sort],
      );
    }

    // Reorder the caller's groups to match the given order.
    for (const [sort, groupId] of (groupOrder ?? []).entries()) {
      await db.execute(
        "UPDATE `board_groups` SET sort = ? WHERE id = ? AND `user` = ?",
        [sort, Number(groupId), userId],
      );
    }

    return { ok: true };
  },
});
