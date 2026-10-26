import dns from "node:dns";
import { BlockList, isIP } from "node:net";

// The server-side request forgery guard, for every URL a user supplies and the
// server then fetches from inside its own network: webhook targets and OAuth
// Client ID Metadata Documents. Without it, "deliver to
// http://169.254.169.254/" reads the cloud metadata service.
//
// It replaces the string matching webhookTarget.ts used to do, which let
// through `[::ffff:127.0.0.1]` (the WHATWG URL parser rewrites it to
// `::ffff:7f00:1`, and the dotted-quad regex never saw that form), the cloud
// metadata address written the same way, `[::127.0.0.1]`, NAT64, 6to4,
// site-local and the benchmarking ranges. Here every address is classified
// numerically (net.BlockList), an IPv4-mapped address is classified as the
// IPv4 address it is, and the check also runs inside the connection's own DNS
// lookup (createGuardedLookup, used by safeFetch), so the address that was
// checked is the address that is dialled. Checking first and then letting
// fetch() resolve the name again left a window for DNS rebinding.

type Range = [address: string, prefix: number];

// Never reachable.
const ALWAYS_BLOCKED_V4: Range[] = [
  ["0.0.0.0", 8], // "this network"
  ["169.254.0.0", 16], // link-local, incl. 169.254.169.254 cloud metadata
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
  ["255.255.255.255", 32], // broadcast
];
// Private, loopback, shared and special-purpose ranges. Only the OAuth
// development escape hatch opens these, and only for loopback.
const PRIVATE_V4: Range[] = [
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["172.16.0.0", 12],
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
];
const ALWAYS_BLOCKED_V6: Range[] = [
  ["::", 128], // unspecified
  ["::", 96], // IPv4-compatible (deprecated), e.g. ::127.0.0.1
  ["::ffff:0:0:0", 96], // IPv4-translated
  ["64:ff9b::", 96], // NAT64
  ["64:ff9b:1::", 48], // local-use NAT64
  ["100::", 64], // discard
  ["2001::", 23], // IETF special purpose, incl. Teredo 2001::/32
  ["2002::", 16], // 6to4 (embeds an IPv4 address)
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
];
const PRIVATE_V6: Range[] = [
  ["::1", 128], // loopback
  ["2001:db8::", 32], // documentation
  ["3fff::", 20], // documentation (RFC 9637)
  ["fc00::", 7], // unique local
  ["fec0::", 10], // site-local (deprecated)
];

// Cloud metadata services that sit inside the private ranges: closed even when
// those are open.
const CLOUD_METADATA_V4: Range[] = [
  ["100.100.100.200", 32], // Alibaba Cloud (inside 100.64.0.0/10)
  ["192.0.0.192", 32], // Oracle Cloud, legacy (inside 192.0.0.0/24)
];
const CLOUD_METADATA_V6: Range[] = [
  ["fd00:ec2::254", 128], // AWS IMDS over IPv6 (inside fc00::/7)
];

function blockList(v4: Range[], v6: Range[]): BlockList {
  const list = new BlockList();
  for (const [address, prefix] of v4) list.addSubnet(address, prefix, "ipv4");
  for (const [address, prefix] of v6) list.addSubnet(address, prefix, "ipv6");
  return list;
}

const ALWAYS_BLOCKED = blockList(ALWAYS_BLOCKED_V4, ALWAYS_BLOCKED_V6);
const PRIVATE = blockList(PRIVATE_V4, PRIVATE_V6);
const CLOUD_METADATA = blockList(CLOUD_METADATA_V4, CLOUD_METADATA_V6);

export interface NetPolicy {
  /** Open the private ranges, loopback included. Off for anything a user can point. */
  allowPrivate: boolean;
}

export const STRICT_NET_POLICY: NetPolicy = { allowPrivate: false };

export const MAX_URL_LENGTH = 2048;

/** The 8 groups of an IPv6 address (any valid textual form), or null. */
function ipv6Groups(ip: string): number[] | null {
  let text = ip.toLowerCase();
  // A trailing dotted quad ("::ffff:1.2.3.4") becomes two hex groups.
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const parts = dotted[2]!.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => !(p >= 0 && p <= 255))) {
      return null;
    }
    const [a, b, c, d] = parts as [number, number, number, number];
    text = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [
    ...head,
    ...Array(halves.length === 2 ? missing : 0).fill("0"),
    ...tail,
  ].map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return groups.length === 8 && groups.every((g) => !Number.isNaN(g))
    ? groups
    : null;
}

/** The IPv4 address inside an IPv4-mapped IPv6 address (::ffff:a.b.c.d), else null. */
export function mappedIPv4(ip: string): string | null {
  const groups = ipv6Groups(ip);
  if (!groups || groups.slice(0, 5).some((g) => g !== 0) || groups[5] !== 0xffff) {
    return null;
  }
  const high = groups[6]!;
  const low = groups[7]!;
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

function stripZone(ip: string): string {
  return ip.replace(/^\[|\]$/g, "").split("%")[0] ?? "";
}

/**
 * Whether the policy lets a connection go to this address. Cloud metadata
 * addresses inside the private ranges are always refused; private ranges
 * follow `allowPrivate`; the always-blocked ranges are refused; everything
 * else (public unicast) is allowed. Not an IP → false.
 */
export function isAllowedAddress(ip: string, policy: NetPolicy): boolean {
  const address = stripZone(String(ip ?? ""));
  const kind = isIP(address);
  if (!kind) return false;
  const v4 = kind === 4 ? address : mappedIPv4(address);
  if (v4) {
    if (CLOUD_METADATA.check(v4, "ipv4")) return false;
    if (PRIVATE.check(v4, "ipv4")) return policy.allowPrivate;
    return !ALWAYS_BLOCKED.check(v4, "ipv4");
  }
  if (CLOUD_METADATA.check(address, "ipv6")) return false;
  if (PRIVATE.check(address, "ipv6")) return policy.allowPrivate;
  return !ALWAYS_BLOCKED.check(address, "ipv6");
}

/** Public unicast only. */
export function isPublicAddress(ip: string): boolean {
  return isAllowedAddress(ip, STRICT_NET_POLICY);
}

export type NetBlockReason =
  | "INVALID_URL"
  | "URL_TOO_LONG"
  | "UNSUPPORTED_PROTOCOL"
  | "CREDENTIALS_IN_URL"
  | "PRIVATE_ADDRESS"
  | "DNS_FAILED";

export type UrlShapeCheck =
  | { ok: true; url: URL; host: string; ipLiteral: string | null }
  | { ok: false; reason: NetBlockReason };

function isLocalhostName(host: string): boolean {
  return host === "localhost" || host.endsWith(".localhost");
}

/**
 * Everything that can be decided without DNS: scheme, length, credentials,
 * and IP-literal hosts — which never reach a DNS lookup, so the connect-time
 * guard would not see them.
 */
export function checkUrlShape(input: unknown, policy: NetPolicy): UrlShapeCheck {
  if (typeof input !== "string" && !(input instanceof URL)) {
    return { ok: false, reason: "INVALID_URL" };
  }
  const text = String(input);
  if (!text) return { ok: false, reason: "INVALID_URL" };
  if (text.length > MAX_URL_LENGTH) return { ok: false, reason: "URL_TOO_LONG" };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reason: "INVALID_URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "UNSUPPORTED_PROTOCOL" };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "CREDENTIALS_IN_URL" };
  }
  const host = url.hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "")
    .toLowerCase();
  if (!host) return { ok: false, reason: "INVALID_URL" };
  const ipLiteral = isIP(host) ? host : null;
  if (ipLiteral && !isAllowedAddress(ipLiteral, policy)) {
    return { ok: false, reason: "PRIVATE_ADDRESS" };
  }
  if (!ipLiteral && isLocalhostName(host) && !policy.allowPrivate) {
    return { ok: false, reason: "PRIVATE_ADDRESS" };
  }
  return { ok: true, url, host, ipLiteral };
}

export type LookupAddress = { address: string; family: number };
export type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;
/** dns.lookup's callback signature, as net.connect calls it. */
export type LookupFunction = (
  hostname: string,
  options: dns.LookupOptions,
  callback: LookupCallback,
) => void;

const systemLookup: LookupFunction = (hostname, options, callback) =>
  dns.lookup(hostname, options as dns.LookupAllOptions, callback as any);

function blockedError(hostname: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`blocked: ${hostname}`), { code: "EBLOCKED" });
}

/**
 * A dns.lookup replacement for a socket's `lookup` option: resolves every
 * address, refuses the connection if *any* of them is not allowed (one
 * internal answer is enough to abuse), and hands only vetted addresses to the
 * socket. Because the socket connects to exactly what this returned, a name
 * that answers "public" to the check and "private" a moment later has nothing
 * to exploit.
 */
export function createGuardedLookup(
  policy: NetPolicy,
  base: LookupFunction = systemLookup,
): LookupFunction {
  return (hostname, options, callback) => {
    const opts: dns.LookupOptions =
      typeof options === "object" && options ? options : {};
    const host = String(hostname).toLowerCase().replace(/\.+$/, "");
    const finish = (addresses: LookupAddress[]) => {
      if (
        !addresses.length ||
        addresses.some((a) => !isAllowedAddress(a.address, policy))
      ) {
        return callback(blockedError(hostname), opts.all ? [] : "", 0);
      }
      const family = opts.family === 4 || opts.family === 6 ? opts.family : 0;
      const usable = family
        ? addresses.filter((a) => a.family === family)
        : addresses;
      if (!usable.length) {
        return callback(
          Object.assign(new Error(`no IPv${family} address for ${hostname}`), {
            code: "ENOTFOUND",
          }),
          opts.all ? [] : "",
          0,
        );
      }
      if (opts.all) callback(null, usable);
      else callback(null, usable[0]!.address, usable[0]!.family);
    };
    // "localhost" is loopback by definition (RFC 6761), whatever a resolver says.
    if (isLocalhostName(host)) {
      return finish([
        { address: "127.0.0.1", family: 4 },
        { address: "::1", family: 6 },
      ]);
    }
    base(
      hostname,
      { ...opts, all: true, order: "verbatim" } as dns.LookupOptions,
      (error, result, family) => {
        if (error) return callback(error, opts.all ? [] : "", 0);
        const addresses = Array.isArray(result)
          ? result
          : typeof result === "string" && result
            ? [{ address: result, family: family ?? (isIP(result) || 4) }]
            : [];
        finish(addresses);
      },
    );
  };
}

function resolveAll(
  hostname: string,
  lookup: LookupFunction,
): Promise<LookupAddress[]> {
  return new Promise((resolve, reject) => {
    lookup(
      hostname,
      { all: true, order: "verbatim" } as dns.LookupOptions,
      (error, result, family) => {
        if (error) return reject(error);
        if (Array.isArray(result)) return resolve(result);
        resolve(result ? [{ address: result, family: family ?? 4 }] : []);
      },
    );
  });
}

export type NetCheck =
  | { ok: true; url: URL; addresses: string[] }
  | { ok: false; reason: NetBlockReason };

/**
 * Pre-flight validation with a reason, for telling a user why a URL is refused
 * ("this points to a private address"). It does not replace the connect-time
 * guard — DNS can answer differently a moment later — it only explains a
 * refusal early.
 */
export async function checkPublicUrl(
  input: unknown,
  opts: { policy?: NetPolicy; lookup?: LookupFunction } = {},
): Promise<NetCheck> {
  const policy = opts.policy ?? STRICT_NET_POLICY;
  const shape = checkUrlShape(input, policy);
  if (!shape.ok) return shape;
  if (shape.ipLiteral) {
    return { ok: true, url: shape.url, addresses: [shape.ipLiteral] };
  }
  let addresses: LookupAddress[];
  try {
    addresses = isLocalhostName(shape.host)
      ? [{ address: "127.0.0.1", family: 4 }]
      : await resolveAll(shape.host, opts.lookup ?? systemLookup);
  } catch {
    return { ok: false, reason: "DNS_FAILED" };
  }
  if (!addresses.length) return { ok: false, reason: "DNS_FAILED" };
  if (addresses.some((a) => !isAllowedAddress(a.address, policy))) {
    return { ok: false, reason: "PRIVATE_ADDRESS" };
  }
  return { ok: true, url: shape.url, addresses: addresses.map((a) => a.address) };
}
