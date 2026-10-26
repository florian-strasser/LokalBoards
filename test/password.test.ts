import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";
import { BCRYPT_ROUNDS, dummyPasswordCheck } from "../server/utils/password";

// The paths that have no password to check (no such account, an account
// without a password) must take as long as the ones that do, or sign-in tells
// anyone timing it which addresses have accounts.

async function elapsed(fn: () => Promise<unknown>): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }
  return times.sort((a, b) => a - b)[1]; // the median of three
}

describe("dummyPasswordCheck", () => {
  it("costs about what a real password check costs", async () => {
    const stored = await bcrypt.hash("correct horse battery staple", BCRYPT_ROUNDS);
    const real = await elapsed(() => bcrypt.compare("wrong password", stored));
    const dummy = await elapsed(() => dummyPasswordCheck("wrong password"));
    expect(dummy).toBeGreaterThan(real * 0.5);
    expect(dummy).toBeLessThan(real * 2 + 50);
  });

  it("replaces a fake hash that cost nothing at all", async () => {
    // What the endpoints compared against before: not a 60-character hash, so
    // bcryptjs refuses it at once instead of doing the work.
    const old = "$2a$10$fakehashforconstanttimecomparison";
    const stored = await bcrypt.hash("x", BCRYPT_ROUNDS);
    const real = await elapsed(() => bcrypt.compare("x", stored));
    const fake = await elapsed(() => bcrypt.compare("x", old));
    expect(await bcrypt.compare("x", old)).toBe(false);
    expect(fake).toBeLessThan(real * 0.2);
  });

  it("accepts anything a request body may carry", async () => {
    for (const value of [undefined, null, "", 42, { a: 1 }]) {
      await expect(dummyPasswordCheck(value)).resolves.toBeUndefined();
    }
  });
});
