// The same parser the board uses, so a result and its tile can never disagree.
import { checklistProgress } from "../../../app/utils/checklistProgress";
import { tileMembers } from "../../utils/boardTiles";
import { attachAssignees } from "../../utils/cardAssignees";

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

export default dataHandler({
  async GET({ db, userId, query: params }) {
    const raw = String(params.q ?? "").trim();
    const empty = { boards: [], cards: [], comments: [], attachments: [] };
    // Below two characters the result set is noise, and the LIKE scan isn't
    // worth running.
    if (raw.length < 2) return { query: raw, ...empty };
    // A very long needle is pointless and just makes the scan expensive.
    const query = raw.slice(0, 100);
    const like = `%${escapeLike(query)}%`;

    const [boards]: any = await db.execute(
      `SELECT b.id, b.name, b.style, b.image, b.user AS owner, (b.user = ?) AS owned
         FROM boards b
        WHERE ${ACCESSIBLE} AND b.name LIKE ? ESCAPE '\\\\'
        ORDER BY b.name ASC
        LIMIT ${PER_GROUP}`,
      [userId, userId, userId, like],
    );

    // The same fields a card tile shows on the board, so a hit carries its
    // checklist progress, comment and attachment counts, due date and the
    // people on it rather than just a name.
    const [cardRows]: any = await db.execute(
      `SELECT c.id, c.name, c.content, c.status, c.dueDate,
              (SELECT COUNT(*) FROM comments co WHERE co.card = c.id) AS commentCount,
              (SELECT COUNT(*) FROM attachments att WHERE att.card = c.id) AS attachmentCount,
              a.name AS areaName, b.id AS boardId, b.name AS boardName
         FROM cards c
         JOIN areas a ON a.id = c.area
         JOIN boards b ON b.id = a.board
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
    const cards = await attachAssignees(db, cardRows);

    // A card's labels travel with it, for two reasons: a hit found by its label
    // should show the word that found it, and a card that says "Bug" on the
    // board should say it here too rather than looking like a different card.
    const labelsByCard = new Map<number, any[]>();
    if (cards.length > 0) {
      const [labelRows]: any = await db.query(
        `SELECT cl.card AS card, l.id, l.name
           FROM \`card_labels\` cl JOIN \`labels\` l ON l.id = cl.label
          WHERE cl.card IN (?) ORDER BY l.sort ASC, l.id ASC`,
        [cards.map((card: any) => card.id)],
      );
      for (const row of labelRows) {
        if (!labelsByCard.has(row.card)) labelsByCard.set(row.card, []);
        labelsByCard.get(row.card)!.push({ id: row.id, name: row.name });
      }
    }

    // Board hits show who is on the board, the way its tile on the dashboard
    // does.
    const members = await tileMembers(
      db,
      boards.map((board: any) => ({ id: board.id, user: board.owner })),
    );

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
        members: members.get(b.id)?.members ?? [],
        memberCount: members.get(b.id)?.memberCount ?? 0,
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
        assignees: c.assignees,
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
  },
});
