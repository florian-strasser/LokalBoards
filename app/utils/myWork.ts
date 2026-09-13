// How the cards assigned to you are grouped on the dashboard.
//
// Three groups, because there are three questions: what is already late, what
// is coming this week, and everything else. "This week" is the next seven days
// counted from the start of today — the same window the board's "Due this week"
// filter uses — so a card cannot be due this week in one place and not in the
// other.

export type MyWorkGroup = "overdue" | "week" | "later";

export const MY_WORK_GROUPS: MyWorkGroup[] = ["overdue", "week", "later"];

const DAY = 86400000;

const dueTime = (card: { dueDate?: string | Date | null }) => {
  if (!card.dueDate) return null;
  const time = new Date(card.dueDate).getTime();
  return Number.isNaN(time) ? null : time;
};

/**
 * The cards, grouped, each group earliest first with undated cards last. Groups
 * with nothing in them are left out. `now` is a parameter so the boundaries can
 * be tested at a fixed moment; the dashboard passes the real one.
 */
export function groupMyWork<T extends { dueDate?: string | Date | null }>(
  cards: T[],
  now: Date = new Date(),
): { key: MyWorkGroup; cards: T[] }[] {
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const weekEnds = startOfToday + 7 * DAY;

  const groups: Record<MyWorkGroup, T[]> = { overdue: [], week: [], later: [] };
  for (const card of cards) {
    const due = dueTime(card);
    if (due === null) groups.later.push(card);
    else if (due < now.getTime()) groups.overdue.push(card);
    else if (due < weekEnds) groups.week.push(card);
    else groups.later.push(card);
  }

  // Stable, so cards that tie — or have no date at all — keep the order the
  // server gave them.
  const byDue = (a: T, b: T) => {
    const left = dueTime(a);
    const right = dueTime(b);
    if (left === right) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return left - right;
  };

  return MY_WORK_GROUPS.map((key) => ({
    key,
    cards: [...groups[key]].sort(byDue),
  })).filter((group) => group.cards.length > 0);
}
