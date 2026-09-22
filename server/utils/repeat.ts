// Cards that repeat.
//
// A repeating card is one with a due date and a rhythm. Marking it done keeps
// it as it is — done, a record of that time — and puts the next one on the
// board: the same card with its checklist unticked, due at the next date in the
// series. So "repeats" is a property of the due date, and nothing else about
// the card has to know.
//
// The series is counted from an anchor: the due date as it was when the rhythm
// was set, or when the due date was last changed by hand. Counting from the
// anchor rather than from the previous card is what keeps a card due on the
// 31st on the 31st: stepped month by month it would land on the 28th in
// February and stay there for good.
//
// Dates are worked out on the instance's own clock (the server's time zone,
// which is also what every date in the app is shown in). Adding a week there
// keeps nine in the morning at nine across a change to summer time, where
// adding seven times twenty-four hours would not.

export const REPEAT_EVERY = ["day", "week", "twoWeeks", "month", "year"] as const;
export type RepeatEvery = (typeof REPEAT_EVERY)[number];

export const isRepeatEvery = (value: unknown): value is RepeatEvery =>
  typeof value === "string" && (REPEAT_EVERY as readonly string[]).includes(value);

const daysInMonth = (year: number, month: number) =>
  new Date(year, month + 1, 0).getDate();

/**
 * The anchor moved on by `count` steps. Months keep the anchor's day where the
 * month has it, and fall back to the month's last day where it does not; an
 * anchor on the last day of its month stays on the last day.
 */
export function occurrence(anchor: Date, every: RepeatEvery, count: number): Date {
  const next = new Date(anchor.getTime());
  if (every === "day") next.setDate(next.getDate() + count);
  else if (every === "week") next.setDate(next.getDate() + 7 * count);
  else if (every === "twoWeeks") next.setDate(next.getDate() + 14 * count);
  else {
    const months = every === "month" ? count : 12 * count;
    const day = anchor.getDate();
    const lastDay =
      day === daysInMonth(anchor.getFullYear(), anchor.getMonth());
    // Day 1 first, so moving the month cannot spill into the one after it.
    next.setDate(1);
    next.setMonth(next.getMonth() + months);
    const room = daysInMonth(next.getFullYear(), next.getMonth());
    next.setDate(lastDay ? room : Math.min(day, room));
  }
  return next;
}

/**
 * The first date in the series that is later than `after`. The board passes the
 * later of the card's own due date and now: done early, the next one is simply
 * the next date; done late, the dates that have already gone by are skipped
 * rather than piled up as overdue cards.
 */
export function nextOccurrence(
  anchor: Date,
  every: RepeatEvery,
  after: Date,
): Date {
  // A daily card that has not been done for a century still stops.
  for (let count = 1; count < 100000; count++) {
    const next = occurrence(anchor, every, count);
    if (next.getTime() > after.getTime()) return next;
  }
  return occurrence(anchor, every, 100000);
}

/**
 * The description with every checklist item unticked — the next card is the
 * same list, still to do. Lines inside a fenced code block are left alone:
 * there they are text about Markdown, not checkboxes.
 */
export function untickChecklist(markdown: string): string {
  let fenced = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (/^[ \t]*```/.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      return line.replace(
        /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+)\[[xX]\]([ \t])/,
        "$1[ ]$2",
      );
    })
    .join("\n");
}

export interface RepeatState {
  repeatEvery: RepeatEvery | null;
  repeatAnchor: Date | null;
  repeatArea: number | null;
}

/**
 * What a card's repeat settings become after an edit.
 *
 * `requested` is what the caller sent: `undefined` leaves the rhythm as it is,
 * `null` or `""` stops it, a rhythm sets it. Without a due date there is
 * nothing to repeat, so clearing the due date stops it too. The anchor follows
 * the due date whenever the rhythm is switched on or changed, and whenever the
 * due date is moved by hand; the column the next card goes to is the one the
 * card is in when the rhythm is switched on.
 */
export function repeatAfterEdit(
  current: {
    repeatEvery?: string | null;
    repeatAnchor?: Date | string | null;
    repeatArea?: number | null;
    area: number;
  },
  requested: unknown,
  due: Date | null,
  dueChanged: boolean,
): RepeatState {
  const was = isRepeatEvery(current.repeatEvery) ? current.repeatEvery : null;
  const every =
    requested === undefined ? was : isRepeatEvery(requested) ? requested : null;
  if (!every || !due) {
    return { repeatEvery: null, repeatAnchor: null, repeatArea: null };
  }
  const anchor =
    every !== was || dueChanged || !current.repeatAnchor
      ? due
      : new Date(current.repeatAnchor);
  const area =
    was && current.repeatArea != null ? Number(current.repeatArea) : current.area;
  return { repeatEvery: every, repeatAnchor: anchor, repeatArea: area };
}
