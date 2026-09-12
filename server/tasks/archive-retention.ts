import { setupDatabase } from "~/lib/databaseSetup";
import { purgeExpiredArchives, retentionDays } from "../utils/archiveRetention";

// Empties the archive of anything older than the retention period. Daily is
// often enough for a window measured in days, and it runs at night because it
// deletes files as well as rows.
export default defineTask({
  meta: {
    name: "archive-retention",
    description: "Remove archived boards, areas and cards past the retention period",
  },
  async run() {
    const days = retentionDays();
    if (days === 0) {
      logger.debug("Archive retention is off; nothing to sweep");
      return { result: "Skipped" };
    }
    try {
      const purged = await purgeExpiredArchives(setupDatabase());
      if (purged.boards || purged.areas || purged.cards) {
        logger.info("Swept the archive", purged);
      }
      return { result: "Success", ...purged };
    } catch (error) {
      logger.error("Error sweeping the archive:", error);
      return { result: "Internal server error" };
    }
  },
});
