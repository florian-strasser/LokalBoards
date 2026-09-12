// Captures a screenshot of every page and modal against a running demo server,
// authenticating as the seeded admin by setting the session cookie directly.
//
//   node scripts/demo/screenshots.mjs <output-dir>
//
// Config via env: DEMO_BASE_URL (default http://127.0.0.1:3100),
// DEMO_TOKEN (default demo-token-alex). The active UI language is whatever the
// server was started with (NUXT_LANGUAGE) — run.sh restarts it per language.
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { chromium } from "@playwright/test";

// Default like gallery.mjs does: without it, running this script directly wrote
// its screenshots into a literal "undefined" folder at the repo root.
const outDir = process.argv[2] ?? "demo-screenshots";
if (!outDir) {
  console.error("usage: node scripts/demo/screenshots.mjs <output-dir>");
  process.exit(1);
}
const base = process.env.DEMO_BASE_URL ?? "http://127.0.0.1:3100";
const TOKEN = process.env.DEMO_TOKEN ?? "demo-token-alex";
const results = [];

const browser = await chromium.launch();

async function shot(ctx, name, url, action) {
  const page = await ctx.newPage();
  try {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(base + url, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(1200);
    if (action) await action(page);
    await page.screenshot({ path: `${outDir}/${name}.png` });
    results.push("ok    " + name);
  } catch (e) {
    results.push("FAIL  " + name + "  :: " + e.message.split("\n")[0]);
  }
  await page.close();
}

// 1440x900 is what the docs and the README ship at. A run that wants another
// size — a portfolio mockup, say — asks for it without changing what the docs
// get: DEMO_WIDTH=1400 DEMO_HEIGHT=900.
const viewport = {
  width: Number(process.env.DEMO_WIDTH || 1440),
  height: Number(process.env.DEMO_HEIGHT || 900),
};
const auth = await browser.newContext({ viewport, deviceScaleFactor: 2 });
await auth.addCookies([{ name: "session_token", value: TOKEN, url: base }]);
const pub = await browser.newContext({ viewport, deviceScaleFactor: 2 });

// A phone-shaped pass, for the one place a 1440-wide board is the wrong picture:
// the homepage hero, where a desktop screenshot scaled to a phone's width turns
// the cards into unreadable specks. Only the board is captured this way — the
// rest of the gallery documents the interface people work in.
const phone = await browser.newContext({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
await phone.addCookies([{ name: "session_token", value: TOKEN, url: base }]);

// --- Public pages (no session) ---
await shot(pub, "01-sign-in", "/");
await shot(pub, "02-sign-up", "/sign-up");
await shot(pub, "03-lost-password", "/lost-password");

// --- Authenticated pages ---
await shot(auth, "10-dashboard", "/dashboard");
await shot(auth, "11-board-kanban", "/board/1");
await shot(auth, "12-board-todo", "/board/3");
await shot(auth, "13-settings", "/settings");
await shot(auth, "14-users", "/users");
await shot(auth, "15-new-user", "/new-user");
await shot(auth, "16-edit-user", "/edit-user/u-ben");

// --- Modals / overlays ---
await shot(auth, "20-modal-create-board", "/dashboard", async (p) => {
  await p.click('[data-onboarding="new-board"]');
  await p.waitForTimeout(600);
});
await shot(auth, "21-menu-actions", "/dashboard", async (p) => {
  await p.click('button[aria-haspopup="menu"]');
  await p.waitForTimeout(400);
});
// A board tile's own menu, on a board this user owns: a shared one offers only
// "leave board", which is the shorter half of the story.
await shot(auth, "32-menu-board-tile", "/dashboard", async (p) => {
  const owned = p
    .locator("[data-board-id]")
    .filter({ hasNot: p.locator("text=Shared") })
    .first();
  await owned.locator('button[aria-haspopup="menu"]').click();
  await p.waitForTimeout(400);
});
await shot(auth, "22-modal-trello-import", "/dashboard", async (p) => {
  await p.click('button[aria-haspopup="menu"]');
  await p.waitForTimeout(300);
  await p.click('[role="menu"] button');
  await p.waitForTimeout(600);
});
// The board's actions live in a three-dots menu: open it, then pick the entry.
// By position rather than by label, because these run in every language — so
// the indices below are the menu's order, and adding an entry moves them:
//   0 board settings · 1 invite · 2 duplicate · 3 archive · 4 archive board
const boardMenuItem = (index) => async (p) => {
  await p.click('button[aria-haspopup="menu"]');
  await p.waitForTimeout(300);
  await p.click(`[role="menu"] button >> nth=${index}`);
  await p.waitForTimeout(600);
};
await shot(auth, "23-modal-board-options", "/board/1", boardMenuItem(0));
await shot(auth, "24-modal-invite", "/board/1", boardMenuItem(1));
await shot(auth, "25-modal-delete-board", "/board/1", boardMenuItem(4));
await shot(auth, "33-modal-duplicate-board", "/board/1", boardMenuItem(2));
await shot(auth, "34-modal-archive", "/board/1", boardMenuItem(3));
// The filter, open, with one label picked so the shot shows both what it offers
// and what it does to the counts in the column headers.
await shot(auth, "35-board-filter", "/board/1", async (p) => {
  await p.locator("button:left-of(button[aria-haspopup='menu'])").first().click();
  await p.waitForTimeout(500);
  const label = p.locator("body > div.fixed.z-50 .label-pill").first();
  if (await label.count()) {
    await label.click();
    await p.waitForTimeout(600);
  }
});
await shot(auth, "26-modal-card", "/board/1", async (p) => {
  await p.click("text=Redesign the logo");
  await p.waitForTimeout(900);
});
// The card's own three-dots menu, holding duplicate and delete. Shot open, so
// the guide can point at the two entries rather than describe where they hide.
await shot(auth, "31-menu-card", "/board/1", async (p) => {
  await p.click("text=Redesign the logo");
  await p.waitForTimeout(900);
  await p.click('.card-modal button[aria-haspopup="menu"]');
  await p.waitForTimeout(400);
});
await shot(auth, "27-modal-image-lightbox", "/board/1", async (p) => {
  await p.click("text=Redesign the logo");
  await p.waitForTimeout(900);
  await p.click("text=logo-mockup.png");
  await p.waitForTimeout(1400);
});
await shot(auth, "28-modal-delete-area", "/board/1", async (p) => {
  await p.locator('[data-onboarding="areas"] > div').first().locator("button").first().click();
  await p.waitForTimeout(600);
});
// The OAuth consent screen, which needs a real request to be consenting to:
// a client identifies itself by publishing a metadata document at a URL, so one
// is served here for the length of the run. The server is started with the
// loopback escape hatch (see run.sh) because that document cannot be HTTPS.
const CLIENT_PORT = 3141;
const clientId = `http://127.0.0.1:${CLIENT_PORT}/client.json`;
const clientServer = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      client_id: clientId,
      client_name: "ChatGPT",
      redirect_uris: [`http://127.0.0.1:${CLIENT_PORT}/callback`],
      token_endpoint_auth_method: "none",
    }),
  );
});
await new Promise((r) => clientServer.listen(CLIENT_PORT, "127.0.0.1", r));

const verifier = randomBytes(48).toString("base64url");
const consentUrl =
  "/oauth/authorize?" +
  new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: `http://127.0.0.1:${CLIENT_PORT}/callback`,
    scope: "boards:read boards:write",
    state: "demo",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  });
await shot(auth, "36-oauth-consent", consentUrl, async (p) => {
  await p.waitForTimeout(900);
});
clientServer.close();

await shot(auth, "30-search", "/dashboard", async (p) => {
  await p.click("header input[type=search]");
  // A term that hits several kinds of result, so the shot shows the grouping.
  await p.type("header input[type=search]", "logo", { delay: 60 });
  await p.waitForTimeout(1200);
});
await shot(auth, "29-modal-delete-user", "/users", async (p) => {
  await p.locator("li", { hasText: "Ben Schmidt" }).locator("button").last().click();
  await p.waitForTimeout(600);
});

// --- Phone ---
await shot(phone, "40-board-kanban-mobile", "/board/1");

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
await browser.close();
process.exit(failed ? 1 : 0);
