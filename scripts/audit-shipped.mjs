// The audit that blocks a build: is anything with a known serious hole in what
// is actually shipped?
//
// `npm audit --omit=dev` was meant to be that question, and for most projects it
// is. Not for a Nuxt one. Nuxt, its modules and with them the whole build
// toolchain — the dev server, the bundler's plugins, the globbing they do — sit
// under `dependencies`, because that is where Nuxt asks for them, so
// "everything but devDependencies" is a good deal more than what runs in
// production. What runs is the built server: `.output/server`, which is the one
// thing the Docker image takes from the build (see the Dockerfile). Nitro
// copies into it exactly the packages the server needs at runtime, and nothing
// from the toolchain.
//
// The difference stopped being academic the day two build-time packages had
// advisories with no fixed release to move to. Neither was in the image; the
// step went red anyway, and nothing done to the dependencies could turn it
// green.
//
// So this asks npm for the same advisories as before and then looks in the
// built server for each one: a high or critical advisory fails the run when a
// version it covers is in there. One that is only in the toolchain is listed
// and let through — the second, informational audit step in CI still shows all
// of them.
//
// It fails closed. No build to look at, an audit npm could not complete, a
// version range this cannot read: each is a failure, not a pass.
//
//   npm run build && node scripts/audit-shipped.mjs [--audit-level=high]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const LEVELS = ["info", "low", "moderate", "high", "critical"];

/** `1.2.3`, `1.2.3-beta.1`, `v1.2.3+build` — or null for anything else. */
export function parseVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    String(text).trim(),
  );
  if (!match) return null;
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ? match[4].split(".") : [],
  };
}

/** Which of two versions comes first, by semver's own order. */
export function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a.numbers[i] !== b.numbers[i]) return a.numbers[i] < b.numbers[i] ? -1 : 1;
  }
  // A version with a pre-release tag comes before the same version without.
  if (!a.pre.length || !b.pre.length) {
    return a.pre.length === b.pre.length ? 0 : a.pre.length ? -1 : 1;
  }
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i], y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn) return Number(x) < Number(y) ? -1 : 1;
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Whether a version is inside a range as npm audit writes one: comparators
 * that must all hold, in alternatives separated by `||` — `<=3.0.3`,
 * `>=5.1.0 <=5.9.2`, `<1.3.2 || >=2.0.0 <2.1.1`, `*`.
 *
 * Returns null when it cannot tell, which the caller counts as inside: a range
 * this does not understand must not be what lets a hole through.
 */
export function inRange(version, range) {
  const v = parseVersion(version);
  if (!v) return null;
  const alternatives = String(range ?? "").split("||").map((part) => part.trim());
  let unsure = false;
  for (const alternative of alternatives) {
    if (alternative === "" || alternative === "*") return true;
    let holds = true;
    for (const comparator of alternative.split(/\s+/)) {
      const match = /^(<=|>=|<|>|=)?(.+)$/.exec(comparator);
      const bound = match && parseVersion(match[2]);
      if (!bound) {
        holds = null;
        break;
      }
      const order = compareVersions(v, bound);
      const ok =
        match[1] === "<" ? order < 0
        : match[1] === "<=" ? order <= 0
        : match[1] === ">" ? order > 0
        : match[1] === ">=" ? order >= 0
        : order === 0;
      if (!ok) {
        holds = false;
        break;
      }
    }
    if (holds === true) return true;
    if (holds === null) unsure = true;
  }
  return unsure ? null : false;
}

/**
 * The advisories in an `npm audit --json` report, each once. The report lists
 * every package that is affected *through* another one as well; those are the
 * same advisory seen from further up the tree, and it is the package the
 * advisory is actually about that has to be looked for.
 */
export function advisoriesIn(report) {
  const seen = new Map();
  for (const entry of Object.values(report?.vulnerabilities ?? {})) {
    for (const via of entry.via ?? []) {
      if (typeof via !== "object" || !via) continue;
      const key = `${via.name}|${via.url ?? via.source}`;
      if (!seen.has(key)) {
        seen.set(key, {
          name: via.name,
          severity: via.severity,
          range: via.range,
          title: via.title,
          url: via.url,
        });
      }
    }
  }
  return [...seen.values()];
}

/**
 * Every package under a directory, as name → the versions of it found. Any
 * `package.json` carrying both a name and a version counts, wherever it is —
 * Nitro keeps second copies of a package under `.nitro/<name>@<version>`, and
 * counting a stray one too many only makes this stricter.
 */
export function packagesIn(directory) {
  const found = new Map();
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "package.json") {
        try {
          const { name, version } = JSON.parse(fs.readFileSync(full, "utf8"));
          if (typeof name === "string" && typeof version === "string") {
            if (!found.has(name)) found.set(name, new Set());
            found.get(name).add(version);
          }
        } catch {}
      }
    }
  };
  walk(directory);
  return found;
}

/**
 * Sort the advisories at or above `level` into the ones that are shipped and
 * the ones that are not. Shipped means a version the advisory covers is among
 * the packages — or one this could not rule out.
 */
export function judge(advisories, shipped, level = "high") {
  const threshold = LEVELS.indexOf(level);
  const blocking = [], elsewhere = [];
  for (const advisory of advisories) {
    if (LEVELS.indexOf(advisory.severity) < threshold) continue;
    const versions = [...(shipped.get(advisory.name) ?? [])];
    const affected = versions.filter((version) => inRange(version, advisory.range) !== false);
    if (affected.length) blocking.push({ ...advisory, shipped: affected });
    else elsewhere.push({ ...advisory, shipped: versions });
  }
  return { blocking, elsewhere };
}

function main() {
  const levelArg = process.argv.find((arg) => arg.startsWith("--audit-level="));
  const level = levelArg ? levelArg.split("=")[1] : "high";
  if (!LEVELS.includes(level)) {
    console.error(`Unknown --audit-level "${level}". One of: ${LEVELS.join(", ")}.`);
    return 1;
  }

  const built = path.resolve(".output/server/node_modules");
  if (!fs.existsSync(built)) {
    console.error(
      "There is no built server to look at (.output/server/node_modules). Run `npm run build` first — " +
        "an audit of what ships cannot pass without anything shipped.",
    );
    return 1;
  }

  // npm exits non-zero when it finds anything, which here is not a failure yet.
  const audit = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  let report;
  try {
    report = JSON.parse(audit.stdout);
  } catch {
    console.error("npm audit did not answer with a report:\n" + (audit.stderr || audit.stdout || audit.error));
    return 1;
  }
  if (report.error || !report.vulnerabilities) {
    console.error("npm audit could not be completed:\n" + JSON.stringify(report.error ?? report, null, 2));
    return 1;
  }

  const shipped = packagesIn(built);
  const { blocking, elsewhere } = judge(advisoriesIn(report), shipped, level);
  const line = (a) => `  ${a.severity.padEnd(8)} ${a.name} ${a.range}\n           ${a.title}\n           ${a.url}`;

  console.log(`${shipped.size} packages in the built server, checked against npm's advisories at "${level}" and above.\n`);
  if (elsewhere.length) {
    console.log("Not shipped — in the build toolchain only, or shipped in a version the advisory does not cover:");
    for (const advisory of elsewhere) {
      console.log(line(advisory));
      if (advisory.shipped.length) console.log(`           shipped as ${advisory.shipped.join(", ")}, which is outside that range`);
    }
    console.log("");
  }
  if (blocking.length) {
    console.error("SHIPPED — in the built server, and so in the image:");
    for (const advisory of blocking) {
      console.error(line(advisory));
      console.error(`           shipped as ${advisory.shipped.join(", ")}`);
    }
    console.error(`\n${blocking.length} advisor${blocking.length === 1 ? "y" : "ies"} to deal with before this ships.`);
    return 1;
  }
  console.log("Nothing that ships is covered by any of them.");
  return 0;
}

// Run as a script, not when a test imports the pieces above.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
