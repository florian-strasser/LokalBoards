import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { db, migrate, resetData, insertUser } from "./db";
import {
  purgeExpiredArchives,
  retentionDays,
} from "../../server/utils/archiveRetention";

// Emptying the archive. The sweep destroys things irreversibly, so what it
// leaves alone matters as much as what it takes: a board archived yesterday, a
// live card in an archived board's neighbour, and the retention setting itself
// all have to behave.

beforeAll(async () => {
  await migrate();
});
beforeEach(async () => {
  await resetData();
  await db().query("DELETE FROM `labels`");
  await db().query("DELETE FROM `card_labels`");
  await db().query("DELETE FROM `card_activity`");
});

const original = process.env.NUXT_ARCHIVE_RETENTION_DAYS;
afterEach(() => {
  if (original === undefined) delete process.env.NUXT_ARCHIVE_RETENTION_DAYS;
  else process.env.NUXT_ARCHIVE_RETENTION_DAYS = original;
});

async function board(id: number, user: string, archivedDaysAgo: number | null) {
  await db().execute(
    "INSERT INTO boards (id, user, name, status, archivedAt) VALUES (?,?,?,?," +
      (archivedDaysAgo === null ? "NULL)" : "DATE_SUB(NOW(), INTERVAL ? DAY))"),
    archivedDaysAgo === null
      ? [id, user, "Board", "private"]
      : [id, user, "Board", "private", archivedDaysAgo],
  );
}
async function area(id: number, boardId: number, archivedDaysAgo: number | null) {
  await db().execute(
    "INSERT INTO areas (id, board, name, sort, archivedAt) VALUES (?,?,?,?," +
      (archivedDaysAgo === null ? "NULL)" : "DATE_SUB(NOW(), INTERVAL ? DAY))"),
    archivedDaysAgo === null
      ? [id, boardId, "Area", 0]
      : [id, boardId, "Area", 0, archivedDaysAgo],
  );
}
async function card(id: number, areaId: number, archivedDaysAgo: number | null) {
  await db().execute(
    "INSERT INTO cards (id, area, name, content, sort, archivedAt) VALUES (?,?,?,?,?," +
      (archivedDaysAgo === null ? "NULL)" : "DATE_SUB(NOW(), INTERVAL ? DAY))"),
    archivedDaysAgo === null
      ? [id, areaId, "Card", "", 0]
      : [id, areaId, "Card", "", 0, archivedDaysAgo],
  );
}
const count = async (table: string) => {
  const [rows]: any = await db().query(`SELECT COUNT(*) AS total FROM \`${table}\``);
  return Number(rows[0].total);
};

describe("retentionDays", () => {
  it("keeps things a month by default", () => {
    delete process.env.NUXT_ARCHIVE_RETENTION_DAYS;
    expect(retentionDays()).toBe(30);
  });

  it("can be set", () => {
    process.env.NUXT_ARCHIVE_RETENTION_DAYS = "90";
    expect(retentionDays()).toBe(90);
  });

  it("treats zero as keeping everything", () => {
    process.env.NUXT_ARCHIVE_RETENTION_DAYS = "0";
    expect(retentionDays()).toBe(0);
  });

  it("falls back to the default rather than to zero when it cannot be read", () => {
    // A typo must not quietly turn the sweep off, and must certainly not be
    // read as "delete immediately".
    for (const bad of ["", "soon", "-5", "NaN"]) {
      process.env.NUXT_ARCHIVE_RETENTION_DAYS = bad;
      expect(retentionDays()).toBe(30);
    }
  });
});

describe("purgeExpiredArchives", () => {
  beforeEach(async () => {
    process.env.NUXT_ARCHIVE_RETENTION_DAYS = "30";
    await insertUser("u1");
  });

  it("takes an archived card that is past the window", async () => {
    await board(1, "u1", null);
    await area(1, 1, null);
    await card(1, 1, 31);
    const result = await purgeExpiredArchives(db());
    expect(result.cards).toBe(1);
    expect(await count("cards")).toBe(0);
  });

  it("leaves one archived inside the window", async () => {
    await board(1, "u1", null);
    await area(1, 1, null);
    await card(1, 1, 29);
    await purgeExpiredArchives(db());
    expect(await count("cards")).toBe(1);
  });

  it("never touches a live card", async () => {
    await board(1, "u1", null);
    await area(1, 1, null);
    await card(1, 1, null);
    await purgeExpiredArchives(db());
    expect(await count("cards")).toBe(1);
  });

  it("takes an expired area with the cards inside it", async () => {
    await board(1, "u1", null);
    await area(1, 1, 40);
    // The cards are not themselves archived — the area took them with it.
    await card(1, 1, null);
    await card(2, 1, null);
    const result = await purgeExpiredArchives(db());
    expect(result.areas).toBe(1);
    expect(await count("areas")).toBe(0);
    expect(await count("cards")).toBe(0);
  });

  it("takes an expired board with everything on it", async () => {
    await board(1, "u1", 60);
    await area(1, 1, null);
    await card(1, 1, null);
    await db().execute(
      "INSERT INTO comments (card, user, content, date) VALUES (?,?,?,NOW())",
      [1, "u1"," a comment"],
    );
    const result = await purgeExpiredArchives(db());
    expect(result.boards).toBe(1);
    expect(await count("boards")).toBe(0);
    expect(await count("areas")).toBe(0);
    expect(await count("cards")).toBe(0);
    expect(await count("comments")).toBe(0);
  });

  it("leaves a neighbouring live board alone", async () => {
    await board(1, "u1", 60);
    await area(1, 1, null);
    await card(1, 1, null);
    await board(2, "u1", null);
    await area(2, 2, null);
    await card(2, 2, null);
    await purgeExpiredArchives(db());
    expect(await count("boards")).toBe(1);
    expect(await count("cards")).toBe(1);
  });

  it("does nothing at all when retention is off", async () => {
    process.env.NUXT_ARCHIVE_RETENTION_DAYS = "0";
    await board(1, "u1", 3650);
    await area(1, 1, null);
    await card(1, 1, 3650);
    const result = await purgeExpiredArchives(db());
    expect(result).toMatchObject({ boards: 0, areas: 0, cards: 0, retentionDays: 0 });
    expect(await count("boards")).toBe(1);
    expect(await count("cards")).toBe(1);
  });

  it("honours a longer window", async () => {
    process.env.NUXT_ARCHIVE_RETENTION_DAYS = "90";
    await board(1, "u1", null);
    await area(1, 1, null);
    await card(1, 1, 60);
    await purgeExpiredArchives(db());
    expect(await count("cards")).toBe(1);
  });
});
