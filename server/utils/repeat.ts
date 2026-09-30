// Cards that repeat.
//
// A repeating card has a rhythm — every day, week, two weeks, month or year —
// and nothing else is required of it. Each time the rhythm comes round the next
// card goes on the board on its own, whether or not the one before it was ever
// marked done: a job that comes back every week comes back every week, and a
// week somebody skipped is a card left undone rather than a card that never
// appeared. What puts it there is the scheduled sweep in `repeatCard.ts`, not
// the tick box.
//
// A due date is optional and independent. With one, the next card is made when
// that date arrives and is due at the next date in the series — so the card for
// next Monday appears as this Monday passes, leaving the week to do it in.
// Without one, the card simply appears each time the rhythm comes round,
// counted from the moment the rhythm was set.
//
// The series is counted from an anchor: the due date as it was when the rhythm
// was set or last moved by hand, or otherwise the moment the rhythm was set.
// Counting from the anchor rather than from the previous card is what keeps a
// card due on the 31st on the 31st: stepped month by month it would land on the
// 28th in February and stay there for good. Taking the due date off a repeating
// card keeps the anchor, so a card that came every Monday keeps coming on
// Mondays.
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
 * The first date in the series that is later than `after`. The sweep passes the
 * later of the card's own date and now: on time, the next one is simply the
 * next date; late — a card nobody touched, or an instance that was switched
 * off for a fortnight — the dates that have gone by are skipped rather than
 * arriving all at once as a pile of cards.
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
  /** When the next card is to be made. What the sweep looks for. */
  repeatNext: Date | null;
}

/**
 * What a card's repeat settings become after an edit.
 *
 * `requested` is what the caller sent: `undefined` leaves the rhythm as it is,
 * `null` or `""` stops it, a rhythm sets it. A due date is not needed — and
 * setting, moving or removing one never stops a card repeating.
 *
 * The anchor follows the due date whenever the rhythm is switched on or
 * changed, and whenever the due date is moved by hand; a card that has no due
 * date is counted from the moment its rhythm was set. The column the next card
 * goes to is the one the card is in when the rhythm is switched on.
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
  now: Date = new Date(),
): RepeatState {
  const was = isRepeatEvery(current.repeatEvery) ? current.repeatEvery : null;
  const every =
    requested === undefined ? was : isRepeatEvery(requested) ? requested : null;
  if (!every) {
    return {
      repeatEvery: null,
      repeatAnchor: null,
      repeatArea: null,
      repeatNext: null,
    };
  }
  const kept = current.repeatAnchor ? new Date(current.repeatAnchor) : null;
  const fresh = every !== was || !kept;
  // With a due date the series hangs off it; without, off the anchor it
  // already had — so taking the due date away leaves the rhythm where it was
  // rather than restarting it from today.
  const anchor = due ? (fresh || dueChanged ? due : kept!) : fresh ? now : kept!;
  const area =
    was && current.repeatArea != null ? Number(current.repeatArea) : current.area;
  return {
    repeatEvery: every,
    repeatAnchor: anchor,
    repeatArea: area,
    repeatNext: due ?? nextOccurrence(anchor, every, now),
  };
}

/**
 * The next card in a series, as dates: when it is due, and when the one after
 * it is to be made. A card with a due date hands its date to the sweep, so the
 * next card is made as this one's date arrives and is due a rhythm later; a
 * card without one is simply made each time the rhythm comes round.
 */
export function planNextCard(
  card: { every: RepeatEvery; anchor: Date; due: Date | null },
  now: Date = new Date(),
): { due: Date | null; repeatNext: Date } {
  if (!card.due) {
    return { due: null, repeatNext: nextOccurrence(card.anchor, card.every, now) };
  }
  const after = new Date(Math.max(card.due.getTime(), now.getTime()));
  const due = nextOccurrence(card.anchor, card.every, after);
  return { due, repeatNext: due };
}
