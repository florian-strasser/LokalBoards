import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";

// The cost every stored password hash is made with.
export const BCRYPT_ROUNDS = 10;

// The shortest password any form here accepts.
const MIN_PASSWORD_LENGTH = 8;

// Something, an @, something with a dot in it, and no spaces anywhere. Loose
// on purpose: whether mail arrives is the real test of an address.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Whether this looks like an e-mail address. */
export function isEmail(value: unknown): value is string {
  return typeof value === "string" && EMAIL.test(value);
}

/** Whether this is a password at least as long as the minimum. */
export function isPasswordLongEnough(value: unknown): value is string {
  return typeof value === "string" && value.length >= MIN_PASSWORD_LENGTH;
}

/** The bcrypt hash a password is stored as. */
export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

// A real bcrypt hash of a random value nobody knows, at the same cost as the
// stored ones. Comparing against it takes as long as checking a real password,
// so "no such account" and "wrong password" cannot be told apart by timing.
//
// It has to be a well-formed 60-character hash. The endpoints used to compare
// against "$2a$10$fakehashforconstanttimecomparison", which is not one, and
// bcryptjs answers a malformed hash at once without doing any work — 0 ms
// against about 70 ms for a real check — so the response time said whether an
// address had an account.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
  randomBytes(18).toString("base64"),
  BCRYPT_ROUNDS,
);

/** Spend the time a password check takes, on the paths that have nothing to check. */
export async function dummyPasswordCheck(password: unknown): Promise<void> {
  await bcrypt.compare(String(password ?? ""), DUMMY_PASSWORD_HASH);
}

// The columns a new `user` row is given. Anything left out keeps the column's
// default, which is how public sign-up has always created its accounts.
export type NewUser = {
  name: string;
  email: string;
  emailVerified: 0 | 1;
  role?: string;
  onboarded?: 0 | 1;
  type?: string;
  emailNotifications?: 0 | 1;
};

/**
 * The password of a user's own, local account — never of their SSO accounts,
 * which have none: the provider is how those sign in, and an account made by
 * SSO stays one the provider alone lets in (see the single sign-on docs).
 *
 * Without a local account nothing is written and the answer is false, unless
 * `create` asks for one — an administrator setting a password means it.
 */
export async function setLocalPassword(
  db: any,
  userId: string,
  password: string,
  { create = false } = {},
): Promise<boolean> {
  const hash = await hashPassword(password);
  const [result]: any = await db.execute(
    "UPDATE `account` SET `password` = ?, `updatedAt` = CURRENT_TIMESTAMP(3) WHERE `userId` = ? AND `providerId` = 'local'",
    [hash, userId],
  );
  if (result.affectedRows > 0) return true;
  if (!create) return false;
  await db.execute(
    "INSERT INTO `account` (`id`, `accountId`, `providerId`, `userId`, `password`) VALUES (?, ?, 'local', ?, ?)",
    [uuidv4(), userId, userId, hash],
  );
  return true;
}

/**
 * Create an account that signs in with a password — the `user` row and the
 * local `account` row holding the hash — in one transaction, and return the
 * new user's id. `alsoInside` runs in the same transaction, after both rows,
 * so whatever it does happens together with the account or not at all.
 *
 * Errors are thrown after the rollback. A taken address arrives as the
 * database's ER_DUP_ENTRY (`user.email` is unique), for the caller to answer.
 */
export async function createLocalUser(
  db: any,
  user: NewUser,
  password: string,
  alsoInside?: (conn: any, userId: string) => Promise<void>,
): Promise<string> {
  const userId = uuidv4();
  const hashedPassword = await hashPassword(password);
  // The names come from the type above, never from a request.
  const columns = Object.keys(user);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO \`user\` (\`id\`, ${columns.map((column) => `\`${column}\``).join(", ")}) ` +
        `VALUES (?${", ?".repeat(columns.length)})`,
      [userId, ...Object.values(user)],
    );
    // A password belongs to the user, not to an address, so the local
    // `accountId` is the user's id: the address can change, and the old one
    // must be free to sign up with again (the `account_provider_subject` index
    // is unique).
    await conn.execute(
      "INSERT INTO `account` (`id`, `accountId`, `providerId`, `userId`, `password`) VALUES (?, ?, ?, ?, ?)",
      [uuidv4(), userId, "local", userId, hashedPassword],
    );
    await alsoInside?.(conn, userId);
    await conn.commit();
    return userId;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
