import { setupDatabase } from "../../app/lib/databaseSetup";

// A card's durable history. Written alongside the transient notifications, but
// kept on the card itself so it can be read back later by anyone who opens it.
//
// The message is NOT stored as prose: `type` + `data` are stored structured and
// the client renders them, so the history is translated into whichever language
// the reader uses rather than the language of whoever performed the action.
export type CardActivityType =
  | "created"
  | "status"
  | "moved"
  | "assigned"
  | "due"
  | "labels"
  | "archived"
  | "restored";

export async function recordCardActivity(
  card: number | string,
  type: CardActivityType,
  actorId: string | null,
  data?: Record<string, unknown>,
): Promise<void> {
  try {
    const db = setupDatabase();
    await db.execute(
      "INSERT INTO `card_activity` (`card`, `actorId`, `type`, `data`) VALUES (?, ?, ?, ?)",
      [card, actorId ?? null, type, data ? JSON.stringify(data) : null],
    );
  } catch (error) {
    // History is a side effect: never fail the user's action because logging
    // it didn't work.
    logger.error("Failed to record card activity:", error);
  }
}
