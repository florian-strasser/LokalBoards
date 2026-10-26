import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

// The cost every stored password hash is made with.
export const BCRYPT_ROUNDS = 10;

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
