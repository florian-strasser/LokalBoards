import { runMigrations, setupDatabase } from "../../app/lib/databaseSetup";
import { repeatDueCards } from "../utils/repeatCard";

// Catch up on repeating cards at startup.
//
// The sweep runs every five minutes (server/tasks/repeat-cards.ts), which is
// enough while the instance is up. It is the time it was down that this is for:
// a server switched off over the weekend, or one that took an hour to come back
// from an upgrade, would otherwise show a board still missing the cards that
// were owed while nobody was watching. Missed turns are skipped rather than
// piled up, so a fortnight off makes one card per series, not fourteen.
//
// It waits for the migrations — `repeatNext` is one of them, and `runMigrations`
// memoises its promise, so this awaits the same run rather than starting a
// second one — and never throws:
// a board that cannot make a card is a board with one card missing, not a
// server that refuses to start. The dev server sits it out, because a dev
// server restarts all day and may well be pointed at somebody else's database.
export default defineNitroPlugin(async () => {
  if (import.meta.dev) return;
  try {
    await runMigrations();
    const { created } = await repeatDueCards(setupDatabase());
    if (created) logger.info(`Repeating cards: ${created} caught up at startup`);
  } catch (error) {
    logger.error("Could not catch up on repeating cards:", error);
  }
});
