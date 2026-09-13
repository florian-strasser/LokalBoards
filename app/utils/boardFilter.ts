// What a board is currently showing.
//
// The filter is held on the board page and applied in the browser to the cards
// it has already loaded: a board is a page's worth of cards, so narrowing it is
// a question about what is on screen rather than a reason to ask the server
// again. Keeping the decision in one tested function also means the count in an
// area's header and the cards under it can never disagree about what matches.

export interface BoardFilter {
  // Card wears at least one of these labels. Picking a second label widens the
  // answer rather than narrowing it, which is what a set of tags should do.
  labels: number[];
  // Card is assigned to one of these people. `UNASSIGNED` stands for nobody.
  assignees: string[];
  // One of "overdue" | "today" | "week" | "none", or null for any.
  due: string | null;
  // true = done, false = open, null = either.
  done: boolean | null;
}

// Accounts are UUIDs, so this can never be one of them.
export const UNASSIGNED = "__unassigned__";

export const EMPTY_FILTER: BoardFilter = {
  labels: [],
  assignees: [],
  due: null,
  done: null,
};

export function isFiltering(filter: BoardFilter): boolean {
  return (
    filter.labels.length > 0 ||
    filter.assignees.length > 0 ||
    filter.due !== null ||
    filter.done !== null
  );
}

const DAY = 86400000;

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

/**
 * Whether a card belongs on the board as it is currently filtered.
 *
 * The parts are combined with "and" — each one you add asks for less — while
 * the values inside `labels` and `assignees` are combined with "or".
 *
 * `now` is a parameter rather than read from the clock, so the date windows can
 * be tested at a fixed moment; the board passes the real one.
 */
export function matchesFilter(
  card: any,
  filter: BoardFilter,
  now: Date = new Date(),
): boolean {
  if (filter.labels.length > 0) {
    const worn = new Set((card.labels || []).map((label: any) => label.id));
    if (!filter.labels.some((id) => worn.has(id))) return false;
  }

  if (filter.assignees.length > 0) {
    const assignee = card.assignee || UNASSIGNED;
    if (!filter.assignees.includes(assignee)) return false;
  }

  if (filter.done !== null && !!card.status !== filter.done) return false;

  if (filter.due !== null) {
    const due = card.dueDate ? new Date(card.dueDate) : null;
    if (filter.due === "none") return due === null;
    if (!due || Number.isNaN(due.getTime())) return false;

    if (filter.due === "overdue") return due.getTime() < now.getTime();

    const today = startOfDay(now);
    // "Due today" and "due this week" are both about what is coming up, which
    // is a different question from what is already late — a card that was due
    // last month is not part of this week's work, and answering both at once
    // would make the two filters impossible to tell apart.
    if (filter.due === "today")
      return due >= today && due.getTime() < today.getTime() + DAY;
    if (filter.due === "week")
      return due >= today && due.getTime() < today.getTime() + 7 * DAY;
  }

  return true;
}

/**
 * The people who have a card on this board, as the filter offers them: each
 * assignee once, plus "nobody" when some card has no assignee at all. Taken
 * from the cards rather than from the board's members, because a member with
 * nothing assigned would only ever filter the board down to nothing.
 */
export function assigneesOf(cards: any[], unassignedLabel: string): any[] {
  const people = new Map<string, any>();
  let anyUnassigned = false;

  for (const card of cards) {
    if (!card.assignee) {
      anyUnassigned = true;
      continue;
    }
    if (!people.has(card.assignee)) {
      people.set(card.assignee, {
        id: card.assignee,
        name: card.assigneeName || card.assignee,
        image: card.assigneeImage || null,
      });
    }
  }

  const list = [...people.values()].sort((a, b) =>
    String(a.name).localeCompare(String(b.name)),
  );
  if (anyUnassigned)
    list.push({ id: UNASSIGNED, name: unassignedLabel, image: null });
  return list;
}

// ---------------------------------------------------------------------------
// The filter in the address.
//
// A filtered board is a link: `?labels=3,7&assignee=none&due=overdue&status=open`
// opens the board showing exactly that, so "everything overdue on the website"
// can be sent to somebody as it stands. Labels are given by id, which is what
// the board filters by; people by account id, with `none` for nobody.
//
// What arrives in an address was typed or pasted by somebody, so reading one
// keeps what it recognises and drops the rest rather than failing: a link with
// one bad value still opens the board, filtered by the good ones.

export const FILTER_QUERY_KEYS = ["labels", "assignee", "due", "status"];

const DUE_VALUES = ["overdue", "today", "week", "none"];
const NOBODY = "none";

const listOf = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value])
    .filter((entry): entry is string => typeof entry === "string")
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);

export function filterToQuery(filter: BoardFilter): Record<string, string> {
  const query: Record<string, string> = {};
  if (filter.labels.length) query.labels = filter.labels.join(",");
  if (filter.assignees.length)
    query.assignee = filter.assignees
      .map((id) => (id === UNASSIGNED ? NOBODY : id))
      .join(",");
  if (filter.due !== null) query.due = filter.due;
  if (filter.done !== null) query.status = filter.done ? "done" : "open";
  return query;
}

export function filterFromQuery(query: Record<string, unknown>): BoardFilter {
  const labels = [
    ...new Set(
      listOf(query.labels)
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  ];
  const assignees = [
    ...new Set(
      listOf(query.assignee)
        .filter((id) => id.length <= 255)
        .map((id) => (id === NOBODY ? UNASSIGNED : id)),
    ),
  ];
  const due = listOf(query.due).find((value) => DUE_VALUES.includes(value));
  const status = listOf(query.status)[0];
  return {
    labels,
    assignees,
    due: due ?? null,
    done: status === "done" ? true : status === "open" ? false : null,
  };
}

/** The address's other parameters as they were, with the filter's replaced. */
export function withFilterQuery(
  query: Record<string, unknown>,
  filter: BoardFilter,
): Record<string, unknown> {
  const rest = Object.fromEntries(
    Object.entries(query).filter(([key]) => !FILTER_QUERY_KEYS.includes(key)),
  );
  return { ...rest, ...filterToQuery(filter) };
}

export function sameFilter(a: BoardFilter, b: BoardFilter): boolean {
  return (
    JSON.stringify(filterToQuery(a)) === JSON.stringify(filterToQuery(b))
  );
}

/** Whether two queries say the same thing, whatever order their keys are in. */
export function sameQuery(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const normal = (query: Record<string, unknown>) =>
    JSON.stringify(
      Object.entries(query)
        .filter(([, value]) => value !== undefined)
        .sort(([left], [right]) => left.localeCompare(right)),
    );
  return normal(a) === normal(b);
}
