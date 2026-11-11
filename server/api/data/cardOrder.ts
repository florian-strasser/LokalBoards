import { readBody } from "h3";
import { orderCard } from "../../utils/cards";

export default dataHandler({
  // A card to another position in its own area, counted the way the board
  // counts: archived cards and gaps are stepped over (see `cardPositions`).
  async POST({ event, db, viaApiKey, cardOf }) {
    const { cardId, areaId, newIndex } = await readBody(event);
    if (!cardId || !areaId || newIndex === undefined) {
      fail(400, "Required fields are missing");
    }
    const found = await cardOf(positiveId(cardId, "Invalid ID values"), "edit");
    if (found.card.area !== positiveId(areaId, "Invalid ID values")) {
      fail(404, "Resource not found");
    }
    await orderCard(db, found, Number(newIndex), viaApiKey);
    return { success: true };
  },
});
