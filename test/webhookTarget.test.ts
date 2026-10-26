import { describe, it, expect } from "vitest";
import {
  checkWebhookTarget,
  isPrivateAddress,
} from "../server/utils/webhookTarget";

// The webhook URL is user-supplied but fetched by the server, so without these
// checks it is an SSRF primitive pointed at the instance's own network.
describe("webhook target validation", () => {
  it("rejects non-http(s) schemes", async () => {
    for (const url of ["file:///etc/passwd", "ftp://x.example/", "gopher://x/"]) {
      expect((await checkWebhookTarget(url)).ok).toBe(false);
    }
  });

  it("rejects loopback, private, link-local and metadata addresses", async () => {
    const blocked = [
      "http://127.0.0.1/hook",
      "http://localhost/hook", // resolves to loopback
      "http://169.254.169.254/latest/meta-data/", // cloud metadata
      "http://10.0.0.5/admin",
      "http://172.16.4.4/",
      "http://192.168.1.1/",
      "http://[::1]:6379/",
      "http://0.0.0.0/",
      "http://100.64.0.1/", // CGNAT
    ];
    for (const url of blocked) {
      const result = await checkWebhookTarget(url);
      expect(result.ok, `${url} should be refused`).toBe(false);
    }
  });

  it("classifies IPv4-mapped IPv6 loopback as private", () => {
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateAddress("::ffff:7f00:1")).toBe(true);
    expect(isPrivateAddress("::ffff:8.8.8.8")).toBe(false);
  });

  // Each of these was accepted by v0.40.3 (verified by running it). The URL
  // parser rewrites `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]`, which the old
  // dotted-quad regex never matched, and the other ranges were not listed.
  it("rejects the addresses the old guard let through", async () => {
    for (const url of [
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:a9fe:a9fe]/", // 169.254.169.254, cloud metadata
      "http://[0:0:0:0:0:ffff:169.254.169.254]/",
      "http://[::127.0.0.1]/", // IPv4-compatible
      "http://[64:ff9b::7f00:1]/", // NAT64
      "http://[2002:7f00:1::]/", // 6to4
      "http://[fec0::1]/", // site-local
      "http://198.18.0.1/", // benchmarking
    ]) {
      const result = await checkWebhookTarget(url);
      expect(result, `${url} should be refused`).toEqual({
        ok: false,
        reason: "The webhook URL must point to a public address",
      });
    }
  });

  it("rejects a host with any internal answer, and explains DNS failures", async () => {
    const lookup = (host: string, options: any, callback: any) => {
      const table: Record<string, string[]> = {
        "hooks.example.test": ["93.184.216.34"],
        "split.example.test": ["93.184.216.34", "10.1.2.3"],
        "mapped.example.test": ["::ffff:a9fe:a9fe"],
      };
      const list = table[host];
      if (!list) return callback(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }), []);
      callback(null, list.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));
    };
    expect(await checkWebhookTarget("https://hooks.example.test/x", { lookup })).toEqual({ ok: true });
    expect((await checkWebhookTarget("https://split.example.test/x", { lookup })).ok).toBe(false);
    expect((await checkWebhookTarget("https://mapped.example.test/x", { lookup })).ok).toBe(false);
    expect(await checkWebhookTarget("https://gone.example.test/x", { lookup })).toEqual({
      ok: false,
      reason: "The webhook host could not be resolved",
    });
  });

  it("rejects credentials in the URL with a reason", async () => {
    const result = await checkWebhookTarget("https://user:secret@8.8.8.8/hook");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/user name or password/);
  });

  it("accepts a public address", async () => {
    expect((await checkWebhookTarget("https://8.8.8.8/hook")).ok).toBe(true);
  });

  it("rejects junk input", async () => {
    for (const url of ["", "not a url", null, undefined, 42, "x".repeat(3000)]) {
      expect((await checkWebhookTarget(url as any)).ok).toBe(false);
    }
  });
});
