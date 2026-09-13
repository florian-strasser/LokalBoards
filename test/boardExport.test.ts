import { describe, it, expect } from "vitest";
import mysql from "mysql2";
import {
  boardFolder,
  downloadDisposition,
  safeFileName,
  slugify,
} from "../server/utils/boardExport";
import { sqlValue } from "../server/utils/sqlDump";

// The small decisions inside an export: what the files in the zip are called,
// what the download is called, and how a value becomes SQL. The export itself,
// including restoring the dump into a real database, is driven end to end by
// tests/export/run.mjs.

const NUL = String.fromCharCode(0);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);

describe("names inside the zip", () => {
  it("makes a board's folder from its id and a readable name", () => {
    expect(boardFolder({ id: 12, name: "Website Relaunch 2026" })).toBe(
      "12-website-relaunch-2026",
    );
    expect(boardFolder({ id: 3, name: "Zur Vorlage / Erledigt" })).toBe(
      "3-zur-vorlage-erledigt",
    );
  });

  it("keeps accented letters as their plain ones", () => {
    expect(slugify("Événements à venir")).toBe("evenements-a-venir");
  });

  it("falls back to a word when nothing readable is left", () => {
    expect(slugify("Дошка")).toBe("board");
    expect(slugify("🚀🚀")).toBe("board");
    expect(boardFolder({ id: 5, name: "" })).toBe("5-board");
  });

  it("keeps a long name short, without a dangling hyphen", () => {
    const slug = slugify("a".repeat(47) + " tail that is cut off");
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("keeps an attachment's own name, unicode and all", () => {
    expect(safeFileName("Quartalszahlen Ü3.xlsx")).toBe("Quartalszahlen Ü3.xlsx");
  });

  it("never lets an attachment's name leave its folder", () => {
    for (const hostile of ["../../etc/passwd", "..\\..\\boot.ini", "/abs/path", "..", "a/../../b"]) {
      const name = safeFileName(hostile);
      expect(name).not.toMatch(/[/\\]/);
      expect(name.startsWith(".")).toBe(false);
    }
    expect(safeFileName(`line${LF}break${NUL}.txt`)).toBe("line_break_.txt");
    expect(safeFileName("")).toBe("file");
  });
});

describe("downloadDisposition", () => {
  it("names the download for old and new clients alike", () => {
    expect(downloadDisposition("12-website-2026-09-13.zip")).toBe(
      `attachment; filename="12-website-2026-09-13.zip"; filename*=UTF-8''12-website-2026-09-13.zip`,
    );
  });

  it("cannot be used to inject a header", () => {
    const value = downloadDisposition(`evil"${CR}${LF}Set-Cookie: x=1.zip`);
    expect(value.includes(CR) || value.includes(LF)).toBe(false);
    expect(value.split('filename="')[1].split('"')[0]).not.toContain('"');
  });
});

describe("sqlValue", () => {
  // The pool's escaping, configured the way the app configures it: UTC.
  const db = { escape: (value: unknown) => mysql.escape(value, false, "Z") };

  it("writes nothing as NULL", () => {
    expect(sqlValue(db, null)).toBe("NULL");
    expect(sqlValue(db, undefined)).toBe("NULL");
  });

  it("escapes the characters that would end a string early", () => {
    const text = `O'Reilly \\ "quoted"${LF}next`;
    const literal = sqlValue(db, text);
    expect(literal.startsWith("'") && literal.endsWith("'")).toBe(true);
    expect(literal).not.toContain(LF);
    expect(literal).toContain("O\\'Reilly");
    expect(literal).toContain("\\\\");
  });

  it("writes numbers as numbers", () => {
    expect(sqlValue(db, 42)).toBe("42");
    expect(sqlValue(db, 0)).toBe("0");
  });

  it("writes a date in UTC, the time zone the dump restores in", () => {
    expect(sqlValue(db, new Date(Date.UTC(2026, 8, 13, 22, 5, 9, 120)))).toBe(
      "'2026-09-13 22:05:09.120'",
    );
  });

  it("writes bytes as bytes", () => {
    expect(sqlValue(db, Buffer.from([0, 255, 16]))).toBe("X'00ff10'");
  });

  it("writes any other object as its JSON text", () => {
    expect(sqlValue(db, { a: 1 })).toBe(`'{\\"a\\":1}'`);
  });
});
