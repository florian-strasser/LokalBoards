import { markdownToHtml } from "../../app/utils/markdown";

// Anybody who may edit a board can tick a box in a comment on it, not only
// whoever wrote the comment — so a tick may change the ticks and nothing else.
//
// Compared as rendered HTML rather than as text: after a box is toggled, the
// browser writes the comment's Markdown out again, and may spell the rest of it
// differently (a `*` bullet comes back as `-`, `*text*` as `_text_`) without
// changing what it says.

const withoutTicks = (html: string) =>
  html
    .replace(/ data-checked="(?:true|false)"/g, "")
    .replace(/<input type="checkbox" checked>/g, '<input type="checkbox">');

/** Whether `after` is `before` with only checklist boxes ticked or unticked. */
export function onlyTicksChanged(
  before: string | null | undefined,
  after: string | null | undefined,
): boolean {
  const old = markdownToHtml(before);
  if (!old.includes('data-type="taskList"')) return false;
  return withoutTicks(old) === withoutTicks(markdownToHtml(after));
}
