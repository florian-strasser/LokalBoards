import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { safeFetch, SafeFetchError } from "../server/utils/safeFetch";
import type { LookupFunction } from "../server/utils/netGuard";
import { fetchClientMetadata } from "../server/utils/oauth";

// safeFetch and the OAuth metadata fetch against an in-process HTTP server on
// loopback. Loopback is private, so a request that is meant to arrive says so
// (`allowPrivate`); everything else has to be refused before a socket opens.
// Hostnames resolve through a fake lookup — no real DNS, no real network.

let server: Server;
let port = 0;
const hits: { url: string; host?: string; method?: string; body: string }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      hits.push({ url: req.url ?? "", host: req.headers.host, method: req.method, body });
      if (req.url === "/redirect") {
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
        return res.end();
      }
      if (req.url === "/big") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(`{"pad":"${"x".repeat(100_000)}"}`);
      }
      if (req.url === "/slow") {
        setTimeout(() => res.end("late"), 1500);
        return;
      }
      if (req.url === "/client.json") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({
            client_id: `http://127.0.0.1:${port}/client.json`,
            client_name: "Test client",
            redirect_uris: ["http://127.0.0.1:9/callback"],
          }),
        );
      }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  hits.length = 0;
});

/** A lookup from a table; `calls` records what the connection asked for. */
function tableLookup(table: Record<string, string[] | (() => string[])>) {
  const calls: string[] = [];
  const lookup: LookupFunction = (hostname, options: any, callback) => {
    calls.push(hostname);
    const entry = table[hostname];
    const list = typeof entry === "function" ? entry() : entry;
    if (!list) {
      return callback(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }), options?.all ? [] : "");
    }
    const addresses = list.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
    if (options?.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  };
  return { lookup, calls };
}

async function refusal(promise: Promise<unknown>): Promise<SafeFetchError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(SafeFetchError);
    return error as SafeFetchError;
  }
  throw new Error("expected a refusal");
}

describe("safeFetch", () => {
  it("refuses loopback, before any request is made", async () => {
    const error = await refusal(safeFetch(`http://127.0.0.1:${port}/`));
    expect(error).toMatchObject({ code: "BLOCKED", reason: "PRIVATE_ADDRESS" });
    expect(hits).toEqual([]);
  });

  it("refuses the IPv6 spellings of loopback and metadata", async () => {
    for (const url of [`http://[::ffff:127.0.0.1]:${port}/`, "http://[::ffff:a9fe:a9fe]/", `http://[::1]:${port}/`]) {
      expect(await refusal(safeFetch(url)), url).toMatchObject({ code: "BLOCKED" });
    }
    expect(hits).toEqual([]);
  });

  it("connects to the address its own lookup vetted (the name is pinned)", async () => {
    const { lookup, calls } = tableLookup({ "hooks.test": ["127.0.0.1"] });
    const res = await safeFetch(`http://hooks.test:${port}/deliver`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "session_token=never-sent" },
      body: '{"event":"card.created"}',
      policy: { allowPrivate: true },
      lookup,
    });
    expect(res).toMatchObject({ status: 200, ok: true });
    expect(res.text()).toBe("ok");
    expect(calls).toEqual(["hooks.test"]);
    expect(hits).toEqual([
      { url: "/deliver", host: `hooks.test:${port}`, method: "POST", body: '{"event":"card.created"}' },
    ]);
  });

  it("closes the DNS-rebinding window: public at the check, private at the connect", async () => {
    let answers = 0;
    const { lookup } = tableLookup({
      "rebind.test": () => (answers++ === 0 ? ["93.184.216.34"] : ["127.0.0.1"]),
    });
    // A pre-flight check (the subscription form) would have seen the public answer…
    const { checkWebhookTarget } = await import("../server/utils/webhookTarget");
    expect(await checkWebhookTarget(`http://rebind.test:${port}/`, { lookup })).toEqual({ ok: true });
    // …but the connection resolves for itself, and is refused.
    const error = await refusal(safeFetch(`http://rebind.test:${port}/`, { lookup }));
    expect(error).toMatchObject({ code: "BLOCKED", reason: "PRIVATE_ADDRESS" });
    expect(hits).toEqual([]);
  });

  it("keeps metadata closed even with private networks open", async () => {
    const { lookup } = tableLookup({ "imds.test": ["169.254.169.254"], "imds6.test": ["fd00:ec2::254"] });
    for (const host of ["imds.test", "imds6.test"]) {
      const error = await refusal(safeFetch(`http://${host}/latest/meta-data/`, { policy: { allowPrivate: true }, lookup }));
      expect(error, host).toMatchObject({ code: "BLOCKED" });
    }
  });

  it("does not follow redirects", async () => {
    const res = await safeFetch(`http://127.0.0.1:${port}/redirect`, { policy: { allowPrivate: true } });
    expect(res.status).toBe(302);
    expect(res.ok).toBe(false);
    expect(hits.map((h) => h.url)).toEqual(["/redirect"]);
  });

  it("caps the body: truncates by default, or refuses", async () => {
    const opts = { policy: { allowPrivate: true }, maxBytes: 1000 };
    const res = await safeFetch(`http://127.0.0.1:${port}/big`, opts);
    expect(res.truncated).toBe(true);
    expect(res.body.length).toBe(1000);
    const error = await refusal(safeFetch(`http://127.0.0.1:${port}/big`, { ...opts, onTooLarge: "error" }));
    expect(error.code).toBe("TOO_LARGE");
  });

  it("times out the whole exchange", async () => {
    const error = await refusal(
      safeFetch(`http://127.0.0.1:${port}/slow`, { policy: { allowPrivate: true }, timeoutMs: 200 }),
    );
    expect(error.code).toBe("TIMEOUT");
  });

  it("reports DNS failures and junk input", async () => {
    const { lookup } = tableLookup({});
    expect(await refusal(safeFetch("https://gone.test/", { lookup }))).toMatchObject({ code: "NETWORK", reason: "DNS_FAILED" });
    expect(await refusal(safeFetch("not a url"))).toMatchObject({ code: "INVALID_URL" });
    expect(await refusal(safeFetch("file:///etc/passwd"))).toMatchObject({ code: "BLOCKED", reason: "UNSUPPORTED_PROTOCOL" });
  });
});

describe("OAuth client metadata fetch", () => {
  it("refuses a client_id on a private or metadata address", async () => {
    const { lookup } = tableLookup({ "intranet.test": ["10.0.0.7"], "imds.test": ["::ffff:169.254.169.254"] });
    for (const id of [
      "https://intranet.test/client.json",
      "https://imds.test/client.json",
      "https://[::ffff:a9fe:a9fe]/client.json",
      "https://127.0.0.1/client.json",
      "https://localhost/client.json",
    ]) {
      expect(await fetchClientMetadata(id, { lookup }), id).toBeNull();
    }
    expect(hits).toEqual([]);
  });

  it("reaches loopback only through the development escape hatch", async () => {
    const id = `http://127.0.0.1:${port}/client.json`;
    const before = process.env.NUXT_OAUTH_ALLOW_INSECURE_CLIENT_METADATA;
    try {
      delete process.env.NUXT_OAUTH_ALLOW_INSECURE_CLIENT_METADATA;
      expect(await fetchClientMetadata(id)).toBeNull();
      expect(hits).toEqual([]);

      process.env.NUXT_OAUTH_ALLOW_INSECURE_CLIENT_METADATA = "true";
      expect(await fetchClientMetadata(id)).toMatchObject({
        id,
        name: "Test client",
        registration: "cimd",
        redirectUris: ["http://127.0.0.1:9/callback"],
      });
    } finally {
      if (before === undefined) delete process.env.NUXT_OAUTH_ALLOW_INSECURE_CLIENT_METADATA;
      else process.env.NUXT_OAUTH_ALLOW_INSECURE_CLIENT_METADATA = before;
    }
  });
});
