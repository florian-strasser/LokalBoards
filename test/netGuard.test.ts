import { describe, it, expect } from "vitest";
import {
  checkPublicUrl,
  checkUrlShape,
  createGuardedLookup,
  isAllowedAddress,
  isPublicAddress,
  mappedIPv4,
  STRICT_NET_POLICY,
  type LookupAddress,
  type LookupFunction,
} from "../server/utils/netGuard";

// The SSRF guard behind webhook deliveries and OAuth metadata fetches. Every
// bypass the old string-matching guard let through is a case here, and so is
// DNS rebinding. No real DNS: hostnames go through a fake lookup.

/** A lookup that answers from a table (or a function, for answers that change). */
function fakeLookup(
  table: Record<string, string[] | (() => string[])>,
): LookupFunction & { calls: string[] } {
  const calls: string[] = [];
  const fn = ((hostname: string, options: any, callback: any) => {
    calls.push(hostname);
    const entry = table[hostname];
    const list = typeof entry === "function" ? entry() : entry;
    if (!list) {
      return callback(
        Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: "ENOTFOUND" }),
        options?.all ? [] : "",
      );
    }
    const addresses: LookupAddress[] = list.map((address) => ({
      address,
      family: address.includes(":") ? 6 : 4,
    }));
    if (options?.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  }) as LookupFunction & { calls: string[] };
  fn.calls = calls;
  return fn;
}

function lookupOnce(lookup: LookupFunction, host: string, options: any = { all: true }) {
  return new Promise<{ error: any; result: any }>((resolve) =>
    lookup(host, options, (error, result) => resolve({ error, result })),
  );
}

describe("isPublicAddress", () => {
  it("accepts public unicast addresses", () => {
    for (const ip of [
      "8.8.8.8",
      "1.1.1.1",
      "93.184.216.34",
      "2606:4700:4700::1111",
      "2001:4860:4860::8888",
      "::ffff:8.8.8.8",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
  });

  it("refuses every reserved IPv4 range", () => {
    for (const ip of [
      "0.0.0.0",
      "0.1.2.3",
      "10.0.0.5",
      "100.64.0.1", // CGNAT
      "127.0.0.1",
      "127.255.0.1",
      "169.254.169.254", // cloud metadata
      "172.16.4.4",
      "172.31.255.255",
      "192.0.0.1",
      "192.0.2.1", // TEST-NET-1
      "192.88.99.1", // 6to4 relay
      "192.168.1.1",
      "198.18.0.1", // benchmarking — let through before
      "198.19.255.255",
      "198.51.100.7", // TEST-NET-2
      "203.0.113.9", // TEST-NET-3
      "224.0.0.1",
      "240.0.0.1",
      "255.255.255.255",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });

  it("keeps the edges of the private ranges public", () => {
    for (const ip of [
      "172.15.255.255",
      "172.32.0.1",
      "100.63.255.255",
      "100.128.0.1",
      "198.17.255.255",
      "198.20.0.1",
      "11.0.0.1",
      "223.255.255.255",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
  });

  it("refuses every reserved IPv6 range, in every spelling", () => {
    for (const ip of [
      "::",
      "::1",
      "::127.0.0.1", // IPv4-compatible — let through before
      "::7f00:1",
      "::ffff:127.0.0.1", // IPv4-mapped, dotted
      "::ffff:7f00:1", // IPv4-mapped, hex: what WHATWG URL produces — let through before
      "::ffff:a9fe:a9fe", // mapped cloud metadata — let through before
      "0:0:0:0:0:ffff:169.254.169.254",
      "::ffff:0:7f00:1", // IPv4-translated
      "64:ff9b::7f00:1", // NAT64 — let through before
      "64:ff9b:1::1",
      "100::1",
      "2001::1", // Teredo
      "2001:db8::1",
      "2002:7f00:1::", // 6to4 — let through before
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "febf::1", // still fe80::/10, which the old prefix match missed
      "fec0::1", // site-local — let through before
      "ff02::1",
      "fe80::1%eth0",
      "fd00:ec2::254", // AWS IMDS over IPv6
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });

  it("refuses anything that is not an IP literal", () => {
    for (const value of ["", "localhost", "example.com", "1.2.3", "999.1.1.1", "::g", null, undefined]) {
      expect(isPublicAddress(value as any), String(value)).toBe(false);
    }
  });

  it("reads the IPv4 address out of a mapped IPv6 address", () => {
    expect(mappedIPv4("::ffff:7f00:1")).toBe("127.0.0.1");
    expect(mappedIPv4("::ffff:192.168.1.1")).toBe("192.168.1.1");
    expect(mappedIPv4("0:0:0:0:0:ffff:a9fe:a9fe")).toBe("169.254.169.254");
    expect(mappedIPv4("2001:db8::1")).toBeNull();
  });
});

describe("isAllowedAddress with private networks open", () => {
  const open = { allowPrivate: true };

  it("opens loopback and the private ranges", () => {
    for (const ip of ["127.0.0.1", "::1", "10.0.0.5", "192.168.1.1", "fd00::1", "::ffff:10.1.2.3"]) {
      expect(isAllowedAddress(ip, open), ip).toBe(true);
    }
  });

  it("keeps link-local, cloud metadata, multicast and IPv4-embedding ranges closed", () => {
    for (const ip of [
      "169.254.169.254",
      "::ffff:a9fe:a9fe",
      "64:ff9b::a9fe:a9fe",
      "2002:a9fe:a9fe::",
      "fe80::1",
      "224.0.0.1",
      "0.0.0.0",
      "fd00:ec2::254",
      "100.100.100.200",
      "192.0.0.192",
    ]) {
      expect(isAllowedAddress(ip, open), ip).toBe(false);
    }
  });
});

describe("checkUrlShape", () => {
  const policy = STRICT_NET_POLICY;

  it("rejects non-http(s) schemes", () => {
    for (const url of ["file:///etc/passwd", "ftp://x.example/", "gopher://x/", "javascript:alert(1)", "data:text/html,hi"]) {
      expect(checkUrlShape(url, policy)).toMatchObject({ ok: false, reason: "UNSUPPORTED_PROTOCOL" });
    }
  });

  it("rejects junk, over-long URLs and credentials", () => {
    for (const url of ["", "not a url", null, undefined, 42]) {
      expect(checkUrlShape(url, policy).ok, String(url)).toBe(false);
    }
    expect(checkUrlShape(`https://example.com/${"x".repeat(3000)}`, policy)).toMatchObject({ reason: "URL_TOO_LONG" });
    expect(checkUrlShape("https://user:pw@example.com/", policy)).toMatchObject({ reason: "CREDENTIALS_IN_URL" });
  });

  it("refuses every literal the old guard let through", () => {
    for (const url of [
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:a9fe:a9fe]/latest/meta-data/",
      "http://[0:0:0:0:0:ffff:169.254.169.254]/",
      "http://[::127.0.0.1]/",
      "http://[64:ff9b::7f00:1]/",
      "http://[2002:7f00:1::]/",
      "http://[fec0::1]/",
      "http://198.18.0.1/",
    ]) {
      expect(checkUrlShape(url, policy), url).toMatchObject({ ok: false, reason: "PRIVATE_ADDRESS" });
    }
  });

  it("refuses the numeric spellings of loopback (normalised by the URL parser)", () => {
    for (const url of ["http://2130706433/", "http://0x7f.1/", "http://017700000001/", "http://127.1/"]) {
      expect(checkUrlShape(url, policy), url).toMatchObject({ ok: false, reason: "PRIVATE_ADDRESS" });
    }
  });

  it("refuses localhost and its subdomains without asking DNS", () => {
    for (const url of ["http://localhost/", "http://LOCALHOST./", "http://app.localhost:3000/"]) {
      expect(checkUrlShape(url, policy), url).toMatchObject({ ok: false, reason: "PRIVATE_ADDRESS" });
    }
  });

  it("accepts a public literal and a hostname (DNS is checked later)", () => {
    expect(checkUrlShape("https://8.8.8.8/hook", policy)).toMatchObject({ ok: true, ipLiteral: "8.8.8.8" });
    expect(checkUrlShape("https://hooks.example.com:8443/x", policy)).toMatchObject({ ok: true, ipLiteral: null });
  });
});

describe("createGuardedLookup", () => {
  it("passes public answers through, in the shape asked for", async () => {
    const guarded = createGuardedLookup(STRICT_NET_POLICY, fakeLookup({ "pub.test": ["93.184.216.34", "2606:2800::1"] }));
    const all = await lookupOnce(guarded, "pub.test", { all: true });
    expect(all.error).toBeNull();
    expect(all.result.map((a: LookupAddress) => a.address)).toEqual(["93.184.216.34", "2606:2800::1"]);
    const one = await lookupOnce(guarded, "pub.test", { family: 6 });
    expect(one.result).toBe("2606:2800::1");
  });

  it("refuses the connection when any answer is internal", async () => {
    const guarded = createGuardedLookup(
      STRICT_NET_POLICY,
      fakeLookup({ "mixed.test": ["93.184.216.34", "10.0.0.1"], "mapped.test": ["::ffff:7f00:1"] }),
    );
    expect((await lookupOnce(guarded, "mixed.test")).error?.code).toBe("EBLOCKED");
    expect((await lookupOnce(guarded, "mapped.test")).error?.code).toBe("EBLOCKED");
  });

  it("treats localhost as loopback whatever the resolver says", async () => {
    const base = fakeLookup({ localhost: ["93.184.216.34"] });
    const guarded = createGuardedLookup(STRICT_NET_POLICY, base);
    expect((await lookupOnce(guarded, "localhost")).error?.code).toBe("EBLOCKED");
    expect(base.calls).toEqual([]);
  });

  it("passes resolver errors on", async () => {
    const guarded = createGuardedLookup(STRICT_NET_POLICY, fakeLookup({}));
    expect((await lookupOnce(guarded, "nowhere.test")).error?.code).toBe("ENOTFOUND");
  });
});

describe("checkPublicUrl", () => {
  it("resolves a hostname and refuses an internal answer", async () => {
    const lookup = fakeLookup({ "pub.test": ["93.184.216.34"], "intranet.test": ["192.168.0.10"] });
    expect(await checkPublicUrl("https://pub.test/hook", { lookup })).toMatchObject({ ok: true, addresses: ["93.184.216.34"] });
    expect(await checkPublicUrl("https://intranet.test/hook", { lookup })).toEqual({ ok: false, reason: "PRIVATE_ADDRESS" });
    expect(await checkPublicUrl("https://nowhere.test/", { lookup })).toEqual({ ok: false, reason: "DNS_FAILED" });
  });

  it("is only a pre-flight: a rebinding name passes it and is stopped at connect", async () => {
    let answers = 0;
    const lookup = fakeLookup({ "rebind.test": () => (answers++ === 0 ? ["93.184.216.34"] : ["127.0.0.1"]) });
    expect((await checkPublicUrl("http://rebind.test/", { lookup })).ok).toBe(true);
    const guarded = createGuardedLookup(STRICT_NET_POLICY, lookup);
    expect((await lookupOnce(guarded, "rebind.test")).error?.code).toBe("EBLOCKED");
  });
});
