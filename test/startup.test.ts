import { describe, it, expect } from "vitest";
import { createStartupTracker } from "../server/utils/startup";

// When the server counts as started, which is when /api/health may say so.
// Nitro starts listening before its async plugins finish, so "the process
// answers" and "the schema is there" are two different moments.

describe("createStartupTracker", () => {
  it("is starting until every step has reported", () => {
    const startup = createStartupTracker();
    expect(startup.state()).toBe("starting");
    startup.done("migrations");
    expect(startup.state()).toBe("starting");
    startup.done("admin");
    expect(startup.state()).toBe("ready");
  });

  it("does not care in which order the steps finish", () => {
    const startup = createStartupTracker();
    startup.done("admin");
    startup.done("migrations");
    expect(startup.state()).toBe("ready");
  });

  it("stays ready when a step reports twice", () => {
    const startup = createStartupTracker();
    startup.done("migrations");
    startup.done("migrations");
    startup.done("admin");
    expect(startup.state()).toBe("ready");
  });

  it("reports a failure over anything else, even once the rest is done", () => {
    const startup = createStartupTracker();
    startup.done("admin");
    startup.fail();
    expect(startup.state()).toBe("failed");
    startup.done("migrations");
    expect(startup.state()).toBe("failed");
  });
});
