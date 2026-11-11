export default dataHandler({
  // The board's areas, in order; archived ones are in the archive.
  async GET({ db, query, boardOf }) {
    const { board } = await boardOf(query.boardId, "read");
    const [areas] = await db.execute(
      "SELECT * FROM areas WHERE board = ? AND archivedAt IS NULL ORDER BY sort ASC",
      [board.id],
    );
    return { areas };
  },
});
