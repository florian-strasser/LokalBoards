import { cardsMatching, withCardDetails } from "../../utils/cardLists";

export default dataHandler({
  // An area's cards, in order, each with what the card window opens on. The
  // filters are optional and narrow one another: `done=true|false`,
  // `assignee=<userId>`, `unassigned=true` and `dueBefore=<ISO 8601>`.
  async GET({ db, query, areaOf }) {
    const { area } = await areaOf(query.areaId, "read");
    const cards = await cardsMatching(db, {
      areaId: area.id,
      done:
        query.done === undefined || query.done === ""
          ? undefined
          : String(query.done) === "true",
      assigneeId: query.assignee ? String(query.assignee) : undefined,
      unassigned: String(query.unassigned) === "true",
      dueBefore: query.dueBefore ? String(query.dueBefore) : undefined,
    });
    return { cards: await withCardDetails(db, cards) };
  },
});
