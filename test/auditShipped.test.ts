import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  advisoriesIn,
  compareVersions,
  inRange,
  judge,
  packagesIn,
  parseVersion,
} from "../scripts/audit-shipped.mjs";

// The audit that blocks a build asks whether an advisory covers something that
// is in the built server. This is a security gate, so most of what is checked
// here is that it says no when it should — and that everything it cannot make
// sense of counts against the build rather than for it.

const version = (text: string) => parseVersion(text)!;

describe("versions", () => {
  it("are read with and without the trimmings", () => {
    expect(parseVersion("5.9.4")?.numbers).toEqual([5, 9, 4]);
    expect(parseVersion("v1.2.3+build.7")?.numbers).toEqual([1, 2, 3]);
    expect(parseVersion("2.0.0-beta.1")?.pre).toEqual(["beta", "1"]);
  });

  it("are not guessed at", () => {
    expect(parseVersion("latest")).toBeNull();
    expect(parseVersion("1.2")).toBeNull();
    expect(parseVersion("")).toBeNull();
  });

  it("are ordered the way semver orders them", () => {
    expect(compareVersions(version("5.9.2"), version("5.9.4"))).toBe(-1);
    expect(compareVersions(version("5.10.0"), version("5.9.4"))).toBe(1);
    expect(compareVersions(version("3.0.3"), version("3.0.3"))).toBe(0);
    // A pre-release comes before the release it leads up to.
    expect(compareVersions(version("2.0.0-rc.1"), version("2.0.0"))).toBe(-1);
    expect(compareVersions(version("2.0.0-rc.2"), version("2.0.0-rc.10"))).toBe(-1);
    expect(compareVersions(version("2.0.0-alpha"), version("2.0.0-beta"))).toBe(-1);
  });
});

describe("a version against an advisory's range", () => {
  it("is inside it or not", () => {
    expect(inRange("3.0.3", "<=3.0.3")).toBe(true);
    expect(inRange("3.0.4", "<=3.0.3")).toBe(false);
    expect(inRange("5.9.2", ">=5.1.0 <=5.9.2")).toBe(true);
    expect(inRange("5.9.4", ">=5.1.0 <=5.9.2")).toBe(false);
    expect(inRange("5.0.9", ">=5.1.0 <=5.9.2")).toBe(false);
  });

  it("can be in any one of several ranges", () => {
    const range = "<1.3.2 || >=2.0.0 <2.1.1";
    expect(inRange("1.3.1", range)).toBe(true);
    expect(inRange("2.1.0", range)).toBe(true);
    expect(inRange("1.4.0", range)).toBe(false);
    expect(inRange("2.1.1", range)).toBe(false);
  });

  it("is inside a range that covers everything", () => {
    expect(inRange("1.0.0", "*")).toBe(true);
    expect(inRange("1.0.0", "")).toBe(true);
  });

  it("is not called safe when the range or the version cannot be read", () => {
    expect(inRange("1.0.0", "^1.0.0")).toBeNull();
    expect(inRange("1.0.0", "1.x")).toBeNull();
    expect(inRange("workspace", "<=3.0.3")).toBeNull();
    // Readable alternatives still count: one of them holding is enough…
    expect(inRange("1.0.0", "^9.0.0 || <=1.0.0")).toBe(true);
    // …and none holding, with one unreadable, is still "cannot tell".
    expect(inRange("5.0.0", "^9.0.0 || <=1.0.0")).toBeNull();
  });
});

describe("the advisories in npm's report", () => {
  // The shape of `npm audit --json`: the package the advisory is about, and
  // everything that depends on it listed again by name.
  const report = {
    vulnerabilities: {
      braces: {
        severity: "high",
        via: [{ name: "braces", severity: "high", range: "<=3.0.3", title: "stack exhaustion", url: "https://example.test/GHSA-1" }],
      },
      micromatch: { severity: "high", via: ["braces"] },
      "fast-glob": { severity: "high", via: ["micromatch"] },
      devalue: {
        severity: "high",
        via: [
          { name: "devalue", severity: "high", range: "<=5.9.2", title: "quadratic expansion", url: "https://example.test/GHSA-2" },
          { name: "devalue", severity: "low", range: ">=1.0.0 <=5.9.2", title: "eager allocation", url: "https://example.test/GHSA-3" },
        ],
      },
    },
  };

  it("are the ones about a package, each once — not everything downstream of it", () => {
    const names = advisoriesIn(report).map((advisory) => `${advisory.name} ${advisory.severity}`);
    expect(names).toEqual(["braces high", "devalue high", "devalue low"]);
  });

  it("are none for a clean report, or for no report at all", () => {
    expect(advisoriesIn({ vulnerabilities: {} })).toEqual([]);
    expect(advisoriesIn(undefined)).toEqual([]);
  });
});

describe("what blocks a build", () => {
  const braces = { name: "braces", severity: "high", range: "<=3.0.3", title: "", url: "" };
  const devalue = { name: "devalue", severity: "high", range: "<=5.9.2", title: "", url: "" };
  const shipped = (packages: Record<string, string[]>) =>
    new Map(Object.entries(packages).map(([name, versions]) => [name, new Set(versions)]));

  it("is an advisory about something in the built server", () => {
    const { blocking, elsewhere } = judge([devalue], shipped({ devalue: ["5.9.2"] }));
    expect(blocking.map((advisory) => advisory.name)).toEqual(["devalue"]);
    expect(blocking[0].shipped).toEqual(["5.9.2"]);
    expect(elsewhere).toEqual([]);
  });

  it("is not one about something that is only in the toolchain", () => {
    const { blocking, elsewhere } = judge([braces], shipped({ devalue: ["5.9.4"] }));
    expect(blocking).toEqual([]);
    expect(elsewhere.map((advisory) => advisory.name)).toEqual(["braces"]);
  });

  it("is not one about a package shipped in a version past it", () => {
    const { blocking, elsewhere } = judge([devalue], shipped({ devalue: ["5.9.4"] }));
    expect(blocking).toEqual([]);
    expect(elsewhere[0].shipped).toEqual(["5.9.4"]);
  });

  it("is one when a second, older copy is shipped beside a fixed one", () => {
    const { blocking } = judge([devalue], shipped({ devalue: ["5.9.4", "5.8.0"] }));
    expect(blocking[0].shipped).toEqual(["5.8.0"]);
  });

  it("is one when the range cannot be read — unknown counts against the build", () => {
    const odd = { ...braces, range: "^3.0.0" };
    expect(judge([odd], shipped({ braces: ["3.0.3"] })).blocking).toHaveLength(1);
  });

  it("leaves what is below the level alone, and takes what is above it", () => {
    const moderate = { ...devalue, severity: "moderate" };
    const critical = { ...devalue, severity: "critical" };
    const built = shipped({ devalue: ["5.9.2"] });
    expect(judge([moderate], built).blocking).toEqual([]);
    expect(judge([critical], built).blocking).toHaveLength(1);
    expect(judge([moderate], built, "moderate").blocking).toHaveLength(1);
  });
});

describe("the packages in a built server", () => {
  let built: string;
  const pkg = (dir: string, json: object) => {
    fs.mkdirSync(path.join(built, dir), { recursive: true });
    fs.writeFileSync(path.join(built, dir, "package.json"), JSON.stringify(json));
  };

  beforeAll(() => {
    built = fs.mkdtempSync(path.join(os.tmpdir(), "audit-shipped-"));
    pkg("devalue", { name: "devalue", version: "5.9.4" });
    pkg("@vue/shared", { name: "@vue/shared", version: "3.5.0" });
    // Nitro keeps a second copy of a package beside the first like this.
    pkg(".nitro/devalue@5.8.0", { name: "devalue", version: "5.8.0" });
    pkg("socket.io/node_modules/debug", { name: "debug", version: "4.3.7" });
    // A file inside a package that only says what kind of module it is.
    pkg("devalue/dist", { type: "module" });
    fs.writeFileSync(path.join(built, "devalue", "broken.json"), "{");
  });
  afterAll(() => fs.rmSync(built, { recursive: true, force: true }));

  it("are found wherever they sit, with every version of each", () => {
    const found = packagesIn(built);
    expect([...found.keys()].sort()).toEqual(["@vue/shared", "debug", "devalue"]);
    expect([...found.get("devalue")!].sort()).toEqual(["5.8.0", "5.9.4"]);
  });

  it("are none where there is nothing built", () => {
    expect(packagesIn(path.join(built, "nowhere")).size).toBe(0);
  });
});
