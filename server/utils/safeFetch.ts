import http from "node:http";
import https from "node:https";
import {
  checkUrlShape,
  createGuardedLookup,
  STRICT_NET_POLICY,
  type LookupFunction,
  type NetBlockReason,
  type NetPolicy,
} from "./netGuard";

// One request to a URL a user controls (a webhook target, an OAuth client's
// metadata document), made so that the request cannot be turned against the
// instance's own network. See netGuard.ts for what is refused and why.
//
// The request goes out through node:http(s) with the guarded DNS lookup as the
// socket's `lookup`, so the address that was checked is the address that is
// connected to — there is no second resolution for a rebinding name to change
// its answer in. IP-literal hosts never reach a lookup, which is why
// checkUrlShape() checks them first. (node:http rather than fetch(): Node's
// built-in fetch has no way to take a lookup, and pinning it through undici's
// Agent would mean a second copy of undici as a dependency. Neither caller
// needs more than one request without redirects.)
//
// Redirects are not followed: a 3xx comes back as it is, which is what both
// callers want — a webhook delivery reports it as a non-2xx answer, and a
// metadata document has to be served from the URL that is its id. The body is
// read up to a cap and no compression is asked for, so a large or
// decompressing answer cannot exhaust memory. One timeout covers the whole
// exchange. No cookies, no credentials.

export type SafeFetchErrorCode =
  | "BLOCKED"
  | "INVALID_URL"
  | "TIMEOUT"
  | "TOO_LARGE"
  | "NETWORK";

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;
  readonly reason?: NetBlockReason;
  constructor(
    code: SafeFetchErrorCode,
    opts: { reason?: NetBlockReason; cause?: unknown; message?: string } = {},
  ) {
    super(
      opts.message ?? (opts.reason ? `${code}: ${opts.reason}` : code),
      opts.cause === undefined ? undefined : { cause: opts.cause },
    );
    this.name = "SafeFetchError";
    this.code = code;
    this.reason = opts.reason;
  }
}

export interface SafeFetchOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  /** Whole exchange, connect to last byte. Default 5 s. */
  timeoutMs?: number;
  /** Bytes of body to keep. Default 1 MB. */
  maxBytes?: number;
  /** "error" throws TOO_LARGE instead of cutting the body off. */
  onTooLarge?: "truncate" | "error";
  /** Skip reading the body (it is discarded). */
  readBody?: boolean;
  /** Default: public addresses only. */
  policy?: NetPolicy;
  /** The DNS lookup to guard. Tests pass a fake one; never real DNS in unit tests. */
  lookup?: LookupFunction;
}

export interface SafeFetchResult {
  status: number;
  ok: boolean;
  /** Lower-cased names, as node:http reports them. */
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  truncated: boolean;
  text(): string;
  json<T = unknown>(): T;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_BYTES = 1024 * 1024;

export async function safeFetch(
  input: string | URL,
  opts: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const policy = opts.policy ?? STRICT_NET_POLICY;
  const shape = checkUrlShape(input, policy);
  if (!shape.ok) {
    const code =
      shape.reason === "INVALID_URL" || shape.reason === "URL_TOO_LONG"
        ? "INVALID_URL"
        : "BLOCKED";
    throw new SafeFetchError(code, { reason: shape.reason });
  }

  const url = shape.url;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = Object.fromEntries(
    Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  );
  // Never carry ambient credentials, and ask for the body as it is.
  delete headers.cookie;
  delete headers["accept-encoding"];
  if (opts.body !== undefined) {
    headers["content-length"] = String(Buffer.byteLength(opts.body));
  }

  const transport = url.protocol === "https:" ? https : http;
  const signal = AbortSignal.timeout(timeoutMs);

  return new Promise<SafeFetchResult>((resolve, reject) => {
    let settled = false;
    const fail = (error: SafeFetchError) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const request = transport.request(
      url,
      {
        method,
        headers,
        // A fresh connection per request: the pinned lookup is the point, and
        // a pooled socket would have been opened by somebody else's.
        agent: false,
        lookup: createGuardedLookup(policy, opts.lookup) as any,
        signal,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        let truncated = false;
        const done = () => {
          if (settled) return;
          settled = true;
          const body = Buffer.concat(chunks);
          const status = response.statusCode ?? 0;
          resolve({
            status,
            ok: status >= 200 && status < 300,
            headers: response.headers,
            body,
            truncated,
            text: () => body.toString("utf8"),
            json<T = unknown>() {
              return JSON.parse(body.toString("utf8")) as T;
            },
          });
        };

        if (opts.readBody === false) {
          response.resume();
          done();
          request.destroy();
          return;
        }
        response.on("data", (chunk: Buffer) => {
          if (settled) return;
          if (bytes + chunk.length > maxBytes) {
            if (opts.onTooLarge === "error") {
              fail(new SafeFetchError("TOO_LARGE"));
            } else {
              chunks.push(chunk.subarray(0, maxBytes - bytes));
              bytes = maxBytes;
              truncated = true;
              done();
            }
            request.destroy();
            return;
          }
          chunks.push(chunk);
          bytes += chunk.length;
        });
        response.on("end", done);
        response.on("error", (error) => fail(classify(error, signal)));
        // A connection that closes mid-body ends neither way on every Node
        // version; without this the promise would wait for the timeout.
        response.on("close", () => {
          if (response.complete) done();
          else if (signal.aborted) fail(new SafeFetchError("TIMEOUT"));
          else fail(new SafeFetchError("NETWORK", { message: "NETWORK: incomplete response" }));
        });
      },
    );

    request.on("error", (error) => fail(classify(error, signal)));
    if (opts.body !== undefined) request.write(opts.body);
    request.end();
  });
}

function classify(error: any, signal: AbortSignal): SafeFetchError {
  if (signal.aborted) return new SafeFetchError("TIMEOUT", { cause: error });
  if (error?.code === "EBLOCKED") {
    return new SafeFetchError("BLOCKED", { reason: "PRIVATE_ADDRESS", cause: error });
  }
  if (error?.code === "ENOTFOUND" || error?.code === "EAI_AGAIN") {
    return new SafeFetchError("NETWORK", {
      reason: "DNS_FAILED",
      cause: error,
      message: `NETWORK: ${error.code}`,
    });
  }
  return new SafeFetchError("NETWORK", {
    cause: error,
    message: `NETWORK: ${error?.code ?? error?.message ?? "request failed"}`,
  });
}
