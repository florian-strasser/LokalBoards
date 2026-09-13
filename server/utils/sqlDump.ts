// The database, as SQL that rebuilds it.
//
// Written from the pool the app already holds rather than by running
// `mysqldump`: the Docker image has no MySQL client in it, a managed database
// may not accept one from where the app runs, and the password would have to be
// handed to a second program on a command line. What comes out is what
// `mysqldump` gives you for these tables — each one's own CREATE statement, then
// its rows — and it restores the same way, into an empty database:
//
//   mysql -u <user> -p <database> < database.sql

// Tables whose structure is exported but whose rows are not. Restoring a
// sign-in session brings back a login that had ended, on whatever machine it
// was, and a verification code is only ever good for minutes. Everyone signs in
// again after a restore, which is what a restore should ask for.
export const ROWS_LEFT_OUT: Record<string, string> = {
  session: "sign-in sessions",
  verification: "one-time verification codes",
};

// Rows are grouped into INSERTs of about this size: small enough for any
// server's `max_allowed_packet`, large enough that a restore is not one
// statement per row. A single row larger than this still gets a statement of
// its own, exactly as `mysqldump` does.
const BATCH_CHARS = 512 * 1024;

/**
 * One value as a SQL literal. The pool's own escaping does strings, numbers,
 * dates and binary; dates come out in UTC, which is what the header sets the
 * restoring session to. Anything else that arrives as an object is written as
 * its JSON text.
 */
export function sqlValue(db: any, value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (
    typeof value !== "object" ||
    value instanceof Date ||
    Buffer.isBuffer(value)
  ) {
    return db.escape(value);
  }
  return db.escape(JSON.stringify(value));
}

async function* tableRows(db: any, table: string): AsyncGenerator<string> {
  const id = db.escapeId(table);
  const connection = await db.getConnection();
  let finished = false;
  try {
    // Streamed, so a table holding years of comments is never in memory at
    // once: rows arrive as fast as the zip takes them.
    const rows = connection.connection.query(`SELECT * FROM ${id}`).stream();
    let columns = "";
    let batch: string[] = [];
    let size = 0;
    const flush = () => {
      const statement = `INSERT INTO ${id} (${columns}) VALUES\n${batch.join(",\n")};\n`;
      batch = [];
      size = 0;
      return statement;
    };
    for await (const row of rows) {
      if (!columns) {
        columns = Object.keys(row)
          .map((column) => db.escapeId(column))
          .join(", ");
        yield "\n";
      }
      const tuple = `(${Object.values(row)
        .map((value) => sqlValue(db, value))
        .join(", ")})`;
      if (batch.length && size + tuple.length > BATCH_CHARS) yield flush();
      batch.push(tuple);
      size += tuple.length;
    }
    if (batch.length) yield flush();
    finished = true;
  } finally {
    // A download abandoned halfway leaves the query still sending rows. That
    // connection cannot go back to the pool for somebody else to use.
    if (finished) connection.release();
    else connection.destroy();
  }
}

export async function* sqlDump(
  db: any,
  options: { version?: string | null; now?: Date } = {},
): AsyncGenerator<string> {
  const { version = null, now = new Date() } = options;

  yield [
    "-- LokalBoards database export",
    `-- ${version ? `LokalBoards ${version}, ` : ""}exported ${now.toISOString()}`,
    "--",
    "-- Restore into an empty database:",
    "--   mysql -u <user> -p <database> < database.sql",
    "--",
    `-- Structure only, no rows, for: ${Object.entries(ROWS_LEFT_OUT)
      .map(([table, what]) => `${table} (${what})`)
      .join(", ")}.`,
    "",
    "SET NAMES utf8mb4;",
    "SET time_zone = '+00:00';",
    "SET FOREIGN_KEY_CHECKS = 0;",
    "SET UNIQUE_CHECKS = 0;",
    "SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';",
    "",
  ].join("\n");

  const [tables]: any = await db.query(
    "SHOW FULL TABLES WHERE `Table_type` = 'BASE TABLE'",
  );
  const names = (tables as any[])
    .map((row) => String(Object.values(row)[0]))
    .sort();

  for (const table of names) {
    const id = db.escapeId(table);
    const [created]: any = await db.query(`SHOW CREATE TABLE ${id}`);
    yield `\n--\n-- ${table}\n--\n\nDROP TABLE IF EXISTS ${id};\n${created[0]["Create Table"]};\n`;
    if (ROWS_LEFT_OUT[table]) continue;
    yield* tableRows(db, table);
  }

  yield "\nSET FOREIGN_KEY_CHECKS = 1;\nSET UNIQUE_CHECKS = 1;\n";
}
