import { defineEventHandler, getQuery } from "h3";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { checklistProgress } from "../../../app/utils/checklistProgress";

// The open cards assigned to the caller, across every board they can still see.
//
// Only what is on you and not done: a card ticked off is finished business, and
// one on a board you have left, or that was archived with its area or its
// board, is not work anybody expects of you any more. Earliest due first, and
// cards with no date after all of those.
//
// The grouping into overdue, this week and later happens in the browser, which
// knows what "today" is for the person looking.
//
// `?count=1` answers only how many there are. The dashboard asks that on every
// visit to decide whether My work is offered at all, and it should not have to
// read five hundred cards to find out there is one.

const LIMIT = 500;

// Which cards count as your work — shared by the list and the count, so the
// switch can never offer a view that then turns out empty.
const OPEN_WORK = `
         FROM \`cards\` c
         JOIN \`areas\` a ON a.\`id\` = c.\`area\`
         JOIN \`boards\` b ON b.\`id\` = a.\`board\`
        WHERE c.\`assignee\` = ?
          AND (c.\`status\` = 0 OR c.\`status\` IS NULL)
          AND c.\`archivedAt\` IS NULL
          AND a.\`archivedAt\` IS NULL
          AND b.\`archivedAt\` IS NULL
          AND (b.\`user\` = ? OR b.\`id\` IN (SELECT \`board\` FROM \`invitations\` WHERE \`user\` = ?))`;

export default defineEventHandler(async (event) => {
  if (event.req.method !== "GET") {
    event.res.statusCode = 405;
    return { error: "Method not allowed" };
  }

  const auth = await resolveUserId(event);
  if (!auth.ok) {
    event.res.statusCode = auth.status;
    return { error: auth.error };
  }
  const userId = auth.userId;
  const db = setupDatabase();

  try {
    if (getQuery(event).count) {
      const [counted]: any = await db.execute(
        `SELECT COUNT(*) AS count ${OPEN_WORK}`,
        [userId, userId, userId],
      );
      return { count: Number(counted[0]?.count ?? 0) };
    }

    const [rows]: any = await db.execute(
      `SELECT c.\`id\`, c.\`name\`, c.\`content\`, c.\`dueDate\`,
              a.\`id\` AS areaId, a.\`name\` AS areaName,
              b.\`id\` AS boardId, b.\`name\` AS boardName
       ${OPEN_WORK}
        ORDER BY c.\`dueDate\` IS NULL, c.\`dueDate\`, b.\`name\`, a.\`sort\`, c.\`sort\`, c.\`id\`
        LIMIT ${LIMIT}`,
      [userId, userId, userId],
    );

    const labelsByCard = new Map<number, any[]>();
    if (rows.length) {
      const [worn]: any = await db.query(
        "SELECT cl.`card`, l.`id`, l.`name` FROM `card_labels` cl JOIN `labels` l ON l.`id` = cl.`label` WHERE cl.`card` IN (?) ORDER BY l.`sort`, l.`id`",
        [rows.map((row: any) => row.id)],
      );
      for (const label of worn) {
        const list = labelsByCard.get(label.card) ?? [];
        list.push({ id: label.id, name: label.name });
        labelsByCard.set(label.card, list);
      }
    }

    return {
      cards: rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        dueDate: row.dueDate ?? null,
        boardId: row.boardId,
        boardName: row.boardName,
        areaId: row.areaId,
        areaName: row.areaName,
        labels: labelsByCard.get(row.id) ?? [],
        checklist: checklistProgress(row.content),
      })),
    };
  } catch (error) {
    logger.error("Database error:", error);
    event.res.statusCode = 500;
    return { error: "Internal server error" };
  }
});
