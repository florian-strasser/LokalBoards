// A label lives exactly as long as some card wears it.
//
// Labels are not a list the board keeps and offers. They are words typed on a
// card; the row in `labels` exists so that the same word on two cards is one
// thing, which is what lets a board filter by it and what fills the list of
// names offered the next time somebody adds one. A row nothing points at is
// therefore not a label the board has — it is a name the board has stopped
// using, and offering it back would be offering rubbish.
//
// Only the ids handed in are looked at. Sweeping a whole board instead would
// race with a label just created inside another card and not yet saved to it,
// and would delete it out from under that card between the two requests.
export async function pruneUnusedLabels(
  db: any,
  labelIds: number[],
): Promise<number> {
  const ids = [
    ...new Set(
      labelIds.map(Number).filter((id) => Number.isInteger(id) && id > 0),
    ),
  ];
  if (!ids.length) return 0;

  const [worn]: any = await db.execute(
    `SELECT DISTINCT \`label\` FROM \`card_labels\` WHERE \`label\` IN (${ids
      .map(() => "?")
      .join(",")})`,
    ids,
  );
  const stillWorn = new Set((worn as any[]).map((row) => Number(row.label)));

  const gone = ids.filter((id) => !stillWorn.has(id));
  if (!gone.length) return 0;

  await db.execute(
    `DELETE FROM \`labels\` WHERE \`id\` IN (${gone.map(() => "?").join(",")})`,
    gone,
  );
  return gone.length;
}
