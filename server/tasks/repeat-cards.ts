import { setupDatabase } from "~/lib/databaseSetup";
import { repeatDueCards } from "../utils/repeatCard";

export default defineTask({
  meta: {
    name: "repeat-cards",
    description: "Put the next card of every repeating series on its board",
  },
  async run() {
    logger.debug("Checking for repeating cards whose turn has come");
    try {
      const { created } = await repeatDueCards(setupDatabase());
      if (created) logger.info(`Repeating cards: ${created} put on a board`);
      return { result: "Success", created };
    } catch (error) {
      logger.error("Error making repeating cards:", error);
      return { result: "Internal server error" };
    }
  },
});
