// Spreadsheet files, written so that double-clicking one opens it properly.
//
// "CSV" is less a format than a family of habits, and the habit that matters
// is Excel's: it splits a file on the list separator of the computer opening
// it. That is a comma in English and a semicolon nearly everywhere a comma is
// the decimal point — German, French, Spanish, Italian, Dutch, Polish,
// Ukrainian, Portuguese, Czech. So the separator follows the instance's
// language, and nobody has to pick one or learn the import dialog.
//
// Three more things Excel needs: a byte-order mark, or it reads UTF-8 as the
// local code page and every umlaut breaks; quotes around anything holding the
// separator, a quote or a line break, with quotes doubled inside; and CRLF
// between rows, which RFC 4180 asks for anyway.
//
// And one thing it must not get: a cell that begins with `=`, `+`, `-` or `@`
// is a formula to a spreadsheet, and a card title like `=HYPERLINK(...)` would
// run when the file is opened. Such cells get a leading apostrophe, the
// spreadsheet's own way of saying "this is text".

const COMMA_LANGUAGES = new Set(["en"]);

export function csvSeparator(language: string): "," | ";" {
  return COMMA_LANGUAGES.has(String(language || "en").slice(0, 2)) ? "," : ";";
}

export function csvCell(value: unknown, separator: string): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  const needsQuotes =
    text.includes(separator) ||
    text.includes('"') ||
    text.includes("\n") ||
    text.includes("\r");
  return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The whole file: a byte-order mark, then one line per row. */
export function toCsv(rows: unknown[][], separator: string): string {
  return (
    "\uFEFF" +
    rows
      .map((row) => row.map((value) => csvCell(value, separator)).join(separator))
      .join("\r\n") +
    "\r\n"
  );
}

/**
 * A date as a spreadsheet reads one — `2026-09-28 09:00` — on the instance's
 * own clock, which is the clock every date in the app is shown on.
 */
export function csvDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
