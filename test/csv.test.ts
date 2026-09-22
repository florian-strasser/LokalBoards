import { describe, it, expect } from "vitest";
import { csvCell, csvDate, csvSeparator, toCsv } from "../server/utils/csv";

describe("csvSeparator", () => {
  it("is a comma in English and a semicolon where a comma is the decimal point", () => {
    expect(csvSeparator("en")).toBe(",");
    for (const language of ["de", "fr", "es", "it", "nl", "pl", "uk", "pt", "cs"]) {
      expect(csvSeparator(language)).toBe(";");
    }
    expect(csvSeparator("")).toBe(",");
  });
});

describe("csvCell", () => {
  it("leaves plain text alone", () => {
    expect(csvCell("Redesign the logo", ",")).toBe("Redesign the logo");
    expect(csvCell(3, ",")).toBe("3");
    expect(csvCell(null, ",")).toBe("");
  });

  it("quotes the separator, quotes and line breaks, doubling the quotes", () => {
    expect(csvCell("Ada, Ben", ",")).toBe('"Ada, Ben"');
    expect(csvCell("Ada, Ben", ";")).toBe("Ada, Ben");
    expect(csvCell("Ada; Ben", ";")).toBe('"Ada; Ben"');
    expect(csvCell('say "hi"', ",")).toBe('"say ""hi"""');
    expect(csvCell("one\ntwo", ",")).toBe('"one\ntwo"');
  });

  it("keeps anything that looks like a formula as text", () => {
    expect(csvCell("=HYPERLINK(\"x\")", ",")).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell("+49 30 123", ",")).toBe("'+49 30 123");
    expect(csvCell("- [ ] a checklist", ",")).toBe("'- [ ] a checklist");
    expect(csvCell("@team", ",")).toBe("'@team");
    expect(csvCell("a = b", ",")).toBe("a = b");
  });
});

describe("toCsv", () => {
  it("starts with a byte-order mark and ends every row with CRLF", () => {
    const file = toCsv([["Card", "Labels"], ["Größe prüfen", "Bug, UI"]], ";");
    expect(file.charCodeAt(0)).toBe(0xfeff);
    expect(file.slice(1)).toBe("Card;Labels\r\nGröße prüfen;Bug, UI\r\n");
  });
});

describe("csvDate", () => {
  it("writes a date a spreadsheet understands, on the local clock", () => {
    expect(csvDate(new Date(2026, 8, 28, 9, 5))).toBe("2026-09-28 09:05");
    expect(csvDate(null)).toBe("");
    expect(csvDate("not a date")).toBe("");
  });
});
