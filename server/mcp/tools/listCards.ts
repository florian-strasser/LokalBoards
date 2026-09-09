import { defineMcpTool } from "@nuxtjs/mcp-toolkit/server";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import {
  requireUserId,
  requireArea,
  requireId,
  areaIdInput,
  serializeCard,
} from "../../utils/mcpHelpers";

const db = setupDatabase();

export default defineMcpTool({
  name: "listCards",
  title: "List cards",
  description:
    "List the cards in an area, in order. Each card has id, areaId, name, Markdown content, done (boolean), dueDate (ISO 8601 or null), assigneeId and position. Requires read access to the board.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: { ...areaIdInput },
  inputExamples: [{ areaId: 1 }],
  handler: async ({ areaId, areaID }) => {
    const userId = requireUserId();
    const id = requireId(areaId, areaID, "areaId");
    await requireArea(id, userId, "read");
    const [rows]: any = await db.execute(
      "SELECT * FROM cards WHERE area = ? AND archivedAt IS NULL ORDER BY sort ASC",
      [id],
    );
    return jsonResult({ cards: rows.map(serializeCard) });
  },
});
