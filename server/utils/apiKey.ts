import { createHash } from "node:crypto";

// The one hash every stored token goes through: API keys, session tokens,
// password-reset and invitation links, OAuth codes and tokens. `hashToken`
// (auth.ts) is this function under the name the rest of the app knows it by,
// so the digests cannot drift apart.
//
// All of those are high-entropy random tokens (an API key is a 32-char hex
// string, see server/api/auth/api-key/create.ts), not user passwords. For such
// tokens a single fast hash (SHA-256) is the right choice — it makes a leaked
// database useless for impersonation (you can't present a hash to authenticate)
// while keeping verification a fast, deterministic, indexed lookup. Slow
// password hashes (bcrypt) only matter for low-entropy secrets.
//
// NOTE: CodeQL reports this as `js/insufficient-password-hash`. That is a false
// positive — the input is a high-entropy random token, not a password — so the
// alert is dismissed ("won't fix") in code scanning. A salted slow hash (bcrypt)
// would also be wrong here: it can't be looked up by an indexed equality match,
// so verification would have to compare against every stored key.
export function hashApiKey(key: string): string {
  return createHash("sha256").update(String(key), "utf8").digest("hex");
}
