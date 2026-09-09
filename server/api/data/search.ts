import { defineEventHandler, getQuery } from "h3";
import { setupDatabase } from "../../../app/lib/databaseSetup";
// The same parser the board uses, so a result and its tile can never disagree.
import { checklistProgress } from "../../../app/utils/checklistProgress";

// GET /api/data/search?q=…
//
// One query across everything the caller can reach: board names, card names and
// descriptions, comment text and attachment filenames. Results come back
// grouped, each with enough context (which board, which card) to be clickable.
//
// Every group repeats the same access predicate — the board is owned by the
// caller or shared with them — so search can never surface a board they
// couldn't already open. There is deliberately no "search everything" path for
// admins: being an admin doesn't grant board access anywhere else either.
const ACCESSIBLE =
  "b.archivedAt IS NULL AND (b.user = ? OR b.id IN (SELECT board FROM invitations WHERE user = ?))";

// Cards, comments and attachments all hang off a card in an area, and every one
// of those three searches joins them as `c` and `a`. Something you archived is
// not something you are looking for.
const LIVE_CARD = "c.archivedAt IS NULL AND a.archivedAt IS NULL";

const PER_GROUP = 8;

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

  const raw = String(getQuery(event).q ?? "").trim();
  const empty = { boards: [], cards: [], comments: [], attachments: [] };
  // Below two characters the result set is noise, and the LIKE scan isn't worth
  // running.
  if (raw.length < 2) return { query: raw, ...empty };
  // A very long needle is pointless and just makes the scan expensive.
  const query = raw.slice(0, 100);
  const like = `%${escapeLike(query)}%`;

  const db = setupDatabase();

  try {
    const [boards]: any = await db.execute(
      `SELECT b.id, b.name, b.style, b.image, b.user AS owner, (b.user = ?) AS owned
         FROM boards b
        WHERE ${ACCESSIBLE} AND b.name LIKE ? ESCAPE '\\\\'
        ORDER BY b.name ASC
        LIMIT ${PER_GROUP}`,
      [userId, userId, userId, like],
    );

    // The same fields a card tile shows on the board, so a hit carries its
    // checklist progress, comment and attachment counts, due date and assignee
    // rather than just a name.
    const [cards]: any = await db.execute(
      `SELECT c.id, c.name, c.content, c.status, c.dueDate, c.assignee,
              au.name AS assigneeName, au.image AS assigneeImage,
              (SELECT COUNT(*) FROM comments co WHERE co.card = c.id) AS commentCount,
              (SELECT COUNT(*) FROM attachments att WHERE att.card = c.id) AS attachmentCount,
              a.name AS areaName, b.id AS boardId, b.name AS boardName
         FROM cards c
         JOIN areas a ON a.id = c.area
         JOIN boards b ON b.id = a.board
         LEFT JOIN \`user\` au ON au.id = c.assignee
        WHERE ${ACCESSIBLE} AND ${LIVE_CARD} AND (
                c.name LIKE ? ESCAPE '\\\\'
                OR c.content LIKE ? ESCAPE '\\\\'
                OR EXISTS (
                     SELECT 1 FROM \`card_labels\` cl
                       JOIN \`labels\` l ON l.id = cl.label
                      WHERE cl.card = c.id AND l.name LIKE ? ESCAPE '\\\\'
                   )
              )
        ORDER BY (c.name LIKE ? ESCAPE '\\\\') DESC, c.id DESC
        LIMIT ${PER_GROUP}`,
      [userId, userId, like, like, like, like],
    );

    // A card's labels travel with it, for two reasons: a hit found by its label
    // should show the word that found it, and a card that says "Bug" on the
    // board should say it here too rather than looking like a different card.
    const labelsByCard = new Map<number, any[]>();
    if (cards.length > 0) {
      const cardPh = cards.map(() => "?").join(",");
      const [labelRows]: any = await db.execute(
        `SELECT cl.card AS card, l.id, l.name
           FROM \`card_labels\` cl JOIN \`labels\` l ON l.id = cl.label
          WHERE cl.card IN (${cardPh}) ORDER BY l.sort ASC, l.id ASC`,
        cards.map((c: any) => c.id),
      );
      for (const row of labelRows as any[]) {
        if (!labelsByCard.has(row.card)) labelsByCard.set(row.card, []);
        labelsByCard.get(row.card)!.push({ id: row.id, name: row.name });
      }
    }

    // Board hits show who is on the board, so attach the members the same way
    // the dashboard does: the owner plus everyone invited, capped at the four
    // the avatar stack shows.
    const boardIds = boards.map((b: any) => b.id);
    const membersByBoard = new Map<number, any[]>();
    if (boardIds.length > 0) {
      const ph = boardIds.map(() => "?").join(",");
      const [inviteRows]: any = await db.execute(
        `SELECT board, \`user\` FROM invitations WHERE board IN (${ph})`,
        boardIds,
      );
      const idsByBoard = new Map<number, string[]>();
      for (const b of boards)
        idsByBoard.set(b.id, b.owner ? [b.owner] : []);
      for (const inv of inviteRows) {
        const list = idsByBoard.get(inv.board);
        if (list && inv.user && !list.includes(inv.user)) list.push(inv.user);
      }
      const unique = [...new Set(([] as string[]).concat(...idsByBoard.values()))];
      const usersById = new Map<string, any>();
      if (unique.length > 0) {
        const uph = unique.map(() => "?").join(",");
        const [userRows]: any = await db.execute(
          `SELECT id, name, image FROM \`user\` WHERE id IN (${uph})`,
          unique,
        );
        for (const u of userRows) usersById.set(u.id, u);
      }
      for (const b of boards) {
        const ids = idsByBoard.get(b.id) || [];
        membersByBoard.set(b.id, {
          count: ids.length,
          list: ids.slice(0, 4).map((id) => usersById.get(id)).filter(Boolean),
        } as any);
      }
    }

    const [comments]: any = await db.execute(
      `SELECT co.id, co.content, co.date,
              COALESCE(u.name, co.authorName) AS authorName, u.image AS authorImage,
              c.id AS cardId, c.name AS cardName,
              b.id AS boardId, b.name AS boardName
         FROM comments co
         JOIN cards c ON c.id = co.card
         JOIN areas a ON a.id = c.area
         JOIN boards b ON b.id = a.board
         LEFT JOIN \`user\` u ON u.id = co.user
        WHERE ${ACCESSIBLE} AND ${LIVE_CARD} AND co.content LIKE ? ESCAPE '\\\\'
        ORDER BY co.date DESC
        LIMIT ${PER_GROUP}`,
      [userId, userId, like],
    );

    const [attachments]: any = await db.execute(
      `SELECT at.id, at.filename, at.filetype, at.filesize,
              c.id AS cardId, c.name AS cardName,
              b.id AS boardId, b.name AS boardName
         FROM attachments at
         JOIN cards c ON c.id = at.card
         JOIN areas a ON a.id = c.area
         JOIN boards b ON b.id = a.board
        WHERE ${ACCESSIBLE} AND ${LIVE_CARD} AND at.filename LIKE ? ESCAPE '\\\\'
        ORDER BY at.id DESC
        LIMIT ${PER_GROUP}`,
      [userId, userId, like],
    );

    return {
      query,
      boards: boards.map((b: any) => ({
        id: b.id,
        name: b.name,
        style: b.style,
        image: b.image,
        owned: !!b.owned,
        members: (membersByBoard.get(b.id) as any)?.list ?? [],
        memberCount: (membersByBoard.get(b.id) as any)?.count ?? 0,
      })),
      // The snippet is only sent when the description is what matched —
      // otherwise the card's own name already explains the hit.
      cards: cards.map((c: any) => ({
        id: c.id,
        name: c.name,
        status: !!c.status,
        areaName: c.areaName,
        boardId: c.boardId,
        boardName: c.boardName,
        dueDate: c.dueDate,
        assignee: c.assignee,
        assigneeName: c.assigneeName,
        assigneeImage: c.assigneeImage,
        commentCount: Number(c.commentCount) || 0,
        attachmentCount: Number(c.attachmentCount) || 0,
        labels: labelsByCard.get(c.id) || [],
        checklist: checklistProgress(c.content),
        snippet: String(c.name ?? "")
          .toLowerCase()
          .includes(query.toLowerCase())
          ? ""
          : searchSnippet(c.content, query),
      })),
      comments: comments.map((co: any) => ({
        id: co.id,
        authorName: co.authorName,
        authorImage: co.authorImage,
        date: co.date,
        cardId: co.cardId,
        cardName: co.cardName,
        boardId: co.boardId,
        boardName: co.boardName,
        snippet: searchSnippet(co.content, query),
      })),
      attachments: attachments.map((at: any) => ({
        id: at.id,
        filename: at.filename,
        filetype: at.filetype,
        filesize: at.filesize,
        cardId: at.cardId,
        cardName: at.cardName,
        boardId: at.boardId,
        boardName: at.boardName,
      })),
    };
  } catch (error) {
    logger.error("Search error:", error);
    event.res.statusCode = 500;
    return { error: "Internal server error" };
  }
});
