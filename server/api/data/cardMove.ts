import { readBody } from "h3";
import { moveCard } from "../../utils/cards";

export default dataHandler({
  // A card into another area — on its board or onto another board the caller
  // may edit — at the position the board shows it in.
  async POST({ event, db, userId, viaApiKey, cardOf, areaOf }) {
    const { cardId, fromAreaId, toAreaId, newIndex } = await readBody(event);
    if (!cardId || !fromAreaId || !toAreaId || newIndex === undefined) {
      fail(400, "Required fields are missing");
    }
    const from = await cardOf(positiveId(cardId, "Invalid ID values"), "edit");
    // The card has to be where the request says it is, or any card at all —
    // from a board the caller cannot even see — could be pulled into theirs.
    if (from.card.area !== positiveId(fromAreaId, "Invalid ID values")) {
      fail(404, "Resource not found");
    }
    const to = await areaOf(positiveId(toAreaId, "Invalid ID values"), "edit");
    if (to.area.archivedAt) fail(404, "Resource not found");
    await moveCard(db, from, to, userId, Number(newIndex), viaApiKey);
    return { success: true };
  },
});
