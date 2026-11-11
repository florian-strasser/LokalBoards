import { defineMcpTool } from "@nuxtjs/mcp-toolkit/server";
import { setupDatabase } from "../../../app/lib/databaseSetup";
import { archiveArea } from "../../utils/areas";
import {
  requireUserId,
  requireWriteAccess,
  requireArea,
  requireId,
  areaIdInput,
} from "../../utils/mcpHelpers";

const db = setupDatabase();

export default defineMcpTool({
  name: "deleteArea",
  title: "Archive an area",
  description:
    "Archive an area (column) with every card in it, as deleting one in the app does. It leaves the board and can be restored from the board's archive, where it is deleted for good after the retention period. Needs edit access to the board.",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: { ...areaIdInput },
  inputExamples: [{ areaId: 1 }],
  handler: async ({ areaId, areaID }) => {
    const userId = requireUserId();
    requireWriteAccess();
    const aid = requireId(areaId, areaID, "areaId");
    const { area } = await requireArea(aid, userId, "edit");
    // Into the archive, as in the app: an agent's mistake can be undone there.
    await archiveArea(db, area, true);
    return jsonResult({ archived: true, areaId: aid });
  },
});
