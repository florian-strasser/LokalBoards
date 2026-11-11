export default dataHandler({
  // A card's own history — who changed what, and when — to anybody who may
  // see the card, and nobody else.
  async GET({ db, query, cardOf }) {
    const { card } = await cardOf(query.cardId, "read");

    // The actor joined, so the timeline can show an avatar.
    const [rows]: any = await db.execute(
      `SELECT ca.id, ca.type, ca.data, ca.createdAt,
              ca.actorId, u.name AS actorName, u.image AS actorImage, u.type AS actorType
         FROM card_activity ca
         LEFT JOIN \`user\` u ON u.id = ca.actorId
        WHERE ca.card = ?
        ORDER BY ca.createdAt ASC, ca.id ASC`,
      [card.id],
    );

    const activity = rows.map((r: any) => {
      let data: any = null;
      try {
        data = r.data ? JSON.parse(r.data) : null;
      } catch {
        data = null;
      }
      return {
        id: r.id,
        type: r.type,
        data,
        createdAt: r.createdAt,
        actorId: r.actorId,
        actorName: r.actorName,
        actorImage: r.actorImage,
        actorType: r.actorType,
      };
    });

    // An entry about somebody put on or taken off the card carries their id;
    // their name is looked up here, so the client does not have to.
    const assigneeIds = [
      ...new Set(
        activity
          .map((a: any) => a.data?.assigneeId)
          .filter((v: any) => typeof v === "string" && v),
      ),
    ];
    if (assigneeIds.length > 0) {
      const ph = assigneeIds.map(() => "?").join(",");
      const [users]: any = await db.execute(
        `SELECT id, name FROM \`user\` WHERE id IN (${ph})`,
        assigneeIds,
      );
      const nameById = new Map(users.map((u: any) => [u.id, u.name]));
      for (const a of activity) {
        if (a.data?.assigneeId) {
          a.data.assigneeName = nameById.get(a.data.assigneeId) ?? null;
        }
      }
    }

    return { activity };
  },
});
