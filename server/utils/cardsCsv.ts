import { checklistProgress } from "../../app/utils/checklistProgress";
import { attachAssignees } from "./cardAssignees";
import { csvDate, csvSeparator, toCsv } from "./csv";
import { serverText } from "./serverText";

// Cards as a spreadsheet: one row per card, in the order the board shows them,
// with the columns somebody reporting on the work would reach for.
//
// Headings and the few words in the cells ("Open", "Every week") are in the
// instance's language, like the rest of the interface. The description is the
// Markdown it is stored as. The last column links to the card, so a row in a
// report can be followed back to the board.

const REPEAT_LABELS: Record<string, string> = {
  day: "repeatDay",
  week: "repeatWeek",
  twoWeeks: "repeatTwoWeeks",
  month: "repeatMonth",
  year: "repeatYear",
};

export interface CsvOptions {
  language: string;
  baseUrl: string;
  // My work spans boards, so it says which board each card is on.
  withBoard?: boolean;
}

/**
 * `cards` need `id`, `name`, `content`, `status`, `dueDate`, `repeatEvery`,
 * `areaName`, `boardId`, `commentCount` and `attachmentCount`, and `boardName`
 * when `withBoard` is set.
 */
export async function cardsToCsv(
  db: any,
  cards: any[],
  options: CsvOptions,
): Promise<string> {
  const t = serverText(options.language);
  const withPeople = await attachAssignees(db, cards);

  const labelsByCard = new Map<number, string[]>();
  if (cards.length) {
    const [worn]: any = await db.query(
      "SELECT cl.`card`, l.`name` FROM `card_labels` cl JOIN `labels` l ON l.`id` = cl.`label` WHERE cl.`card` IN (?) ORDER BY l.`sort`, l.`id`",
      [cards.map((card) => card.id)],
    );
    for (const row of worn) {
      const list = labelsByCard.get(Number(row.card)) ?? [];
      list.push(row.name);
      labelsByCard.set(Number(row.card), list);
    }
  }

  const base = String(options.baseUrl || "").replace(/\/+$/, "");
  const header = [
    ...(options.withBoard ? [t("board")] : []),
    t("csvArea"),
    t("csvCard"),
    t("status"),
    t("dueDate"),
    t("repeat"),
    t("csvAssignees"),
    t("labels"),
    t("csvChecklist"),
    t("csvComments"),
    t("attachments"),
    t("csvDescription"),
    t("csvLink"),
  ];
  const rows = withPeople.map((card) => {
    const checklist = checklistProgress(card.content);
    return [
      ...(options.withBoard ? [card.boardName] : []),
      card.areaName,
      card.name,
      card.status ? t("filterDone") : t("filterOpen"),
      csvDate(card.dueDate),
      card.repeatEvery ? t(REPEAT_LABELS[card.repeatEvery] ?? "repeat") : "",
      card.assignees.map((person: any) => person.name ?? "").join(", "),
      (labelsByCard.get(Number(card.id)) ?? []).join(", "),
      checklist.total
        ? t("csvChecklistProgress", checklist)
        : "",
      Number(card.commentCount) || 0,
      Number(card.attachmentCount) || 0,
      card.content ?? "",
      base ? `${base}/board/${card.boardId}?card=${card.id}` : "",
    ];
  });

  return toCsv([header, ...rows], csvSeparator(options.language));
}

/** A board's cards, in the order the board shows them. */
export async function boardCsv(
  db: any,
  boardId: number,
  options: CsvOptions,
): Promise<string> {
  const [cards]: any = await db.execute(
    `SELECT c.id, c.name, c.content, c.status, c.dueDate, c.repeatEvery,
            a.name AS areaName, a.board AS boardId,
            (SELECT COUNT(*) FROM comments co WHERE co.card = c.id) AS commentCount,
            (SELECT COUNT(*) FROM attachments att WHERE att.card = c.id) AS attachmentCount
       FROM cards c JOIN areas a ON a.id = c.area
      WHERE a.board = ? AND c.archivedAt IS NULL AND a.archivedAt IS NULL
      ORDER BY a.sort, a.id, c.sort, c.id`,
    [boardId],
  );
  return cardsToCsv(db, cards, options);
}
