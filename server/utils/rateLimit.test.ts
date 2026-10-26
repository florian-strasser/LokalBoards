import { describe, it, expect } from "vitest";
import {
  clientIp,
  createRateLimiter,
  forwardedClient,
  trustedProxies,
} from "./rateLimit";

describe("createRateLimiter", () => {
  describe("consume (every request counts)", () => {
    it("allows up to max requests and blocks the next one", () => {
      const rl = createRateLimiter({ max: 3, windowMs: 1000 });
      expect(rl.consume("ip", 0).allowed).toBe(true); // 1
      expect(rl.consume("ip", 0).allowed).toBe(true); // 2
      expect(rl.consume("ip", 0).allowed).toBe(true); // 3
      expect(rl.consume("ip", 0).allowed).toBe(false); // 4 — blocked
    });

    it("reports remaining and retryAfterMs", () => {
      const rl = createRateLimiter({ max: 2, windowMs: 1000 });
      expect(rl.consume("ip", 0)).toMatchObject({ allowed: true, remaining: 1 });
      expect(rl.consume("ip", 0)).toMatchObject({ allowed: true, remaining: 0 });
      const blocked = rl.consume("ip", 200);
      expect(blocked.allowed).toBe(false);
      expect(blocked.retryAfterMs).toBe(800); // resetAt (1000) - now (200)
    });

    it("resets after the window elapses", () => {
      const rl = createRateLimiter({ max: 1, windowMs: 1000 });
      expect(rl.consume("ip", 0).allowed).toBe(true);
      expect(rl.consume("ip", 500).allowed).toBe(false); // same window
      expect(rl.consume("ip", 1000).allowed).toBe(true); // expired -> reset
    });

    it("tracks keys independently", () => {
      const rl = createRateLimiter({ max: 1, windowMs: 1000 });
      expect(rl.consume("a", 0).allowed).toBe(true);
      expect(rl.consume("b", 0).allowed).toBe(true); // different key, own budget
      expect(rl.consume("a", 0).allowed).toBe(false);
    });
  });

  describe("peek (does not count)", () => {
    it("does not consume budget", () => {
      const rl = createRateLimiter({ max: 1, windowMs: 1000 });
      // Peeking any number of times must not exhaust the budget.
      expect(rl.peek("ip", 0).allowed).toBe(true);
      expect(rl.peek("ip", 0).allowed).toBe(true);
      expect(rl.consume("ip", 0).allowed).toBe(true); // first real hit allowed
    });

    it("reports blocked once the budget is exhausted by consume", () => {
      const rl = createRateLimiter({ max: 2, windowMs: 1000 });
      rl.consume("ip", 0); // 1 failure
      rl.consume("ip", 0); // 2 failures -> at max
      expect(rl.peek("ip", 0).allowed).toBe(false); // next would be blocked
    });

    it("models login: successful logins (peek only) never lock out", () => {
      const rl = createRateLimiter({ max: 3, windowMs: 1000 });
      // 100 successful logins from one IP: peek each time, never consume.
      for (let i = 0; i < 100; i++) {
        expect(rl.peek("office-ip", 0).allowed).toBe(true);
      }
    });
  });
});

// The address the limits count by. A client must not be able to pick its own
// by sending X-Forwarded-For, which v0.40.3 believed from anybody.
function request(peer: string, forwardedFor?: string): any {
  return {
    node: {
      req: {
        headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : {},
        socket: { remoteAddress: peer },
      },
    },
  };
}

describe("clientIp", () => {
  it("ignores X-Forwarded-For from a client on the internet (auto)", () => {
    expect(clientIp(request("81.2.69.160", "1.2.3.4"), "auto")).toBe("81.2.69.160");
    expect(clientIp(request("8.8.4.4", "1.2.3.4"), "auto")).toBe("8.8.4.4");
  });

  it("believes the proxy in front when the connection comes from loopback or a private network (auto)", () => {
    expect(clientIp(request("127.0.0.1", "93.184.216.34"), "auto")).toBe("93.184.216.34");
    expect(clientIp(request("::ffff:172.18.0.2", "93.184.216.34"), "auto")).toBe("93.184.216.34");
  });

  it("reads from the right, so a client cannot prepend an address of its choosing", () => {
    // The client sent "1.1.1.1"; nginx appended the address it really saw.
    expect(clientIp(request("127.0.0.1", "1.1.1.1, 93.184.216.34"), "auto")).toBe("93.184.216.34");
    expect(clientIp(request("127.0.0.1", "1.1.1.1, 198.41.0.4, 93.184.216.34"), 2)).toBe("198.41.0.4");
  });

  it("never believes the header when told there is no proxy", () => {
    expect(clientIp(request("127.0.0.1", "93.184.216.34"), 0)).toBe("127.0.0.1");
  });

  it("believes a configured proxy whatever its address", () => {
    expect(clientIp(request("81.2.69.160", "93.184.216.34"), 1)).toBe("93.184.216.34");
  });

  it("falls back to the peer, then to a constant", () => {
    expect(clientIp(request("127.0.0.1"), "auto")).toBe("127.0.0.1");
    expect(clientIp({ node: { req: { headers: {}, socket: {} } } }, "auto")).toBe("unknown");
  });
});

describe("trustedProxies (NUXT_TRUST_PROXY)", () => {
  it("reads the setting", () => {
    expect(trustedProxies("")).toBe("auto");
    expect(trustedProxies("auto")).toBe("auto");
    expect(trustedProxies(true)).toBe(1);
    expect(trustedProxies("true")).toBe(1);
    expect(trustedProxies("2")).toBe(2);
    expect(trustedProxies(3)).toBe(3);
    expect(trustedProxies(false)).toBe(0);
    expect(trustedProxies("false")).toBe(0);
    expect(trustedProxies("yes please")).toBe(0);
    expect(trustedProxies("99")).toBe(10);
  });

  it("counts entries from the end of the list", () => {
    expect(forwardedClient("a, b, c", 1)).toBe("c");
    expect(forwardedClient("a, b, c", 3)).toBe("a");
    expect(forwardedClient("a, b, c", 5)).toBe("a");
    expect(forwardedClient("a", 0)).toBeNull();
    expect(forwardedClient("", 1)).toBeNull();
  });
});
