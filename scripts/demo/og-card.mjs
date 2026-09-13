// The social preview card: the image a link to the website unfolds into.
//
// It carries a screenshot of the app, so it goes out of date with the app — and
// being made by hand once, it did, showing bins where the areas have an archive
// and no filter, no counts and no labels. It is rendered from the same capture
// as the homepage hero now, on every screenshot run.
//
//   node scripts/demo/og-card.mjs [board screenshot] [output]
//
// Defaults to the English kanban capture and docs/public/images/og-card.png.
// 1200 × 630, the size every network that reads Open Graph asks for.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const [
  source = "demo-screenshots/en/11-board-kanban.png",
  output = "docs/public/images/og-card.png",
] = process.argv.slice(2);

if (!fs.existsSync(source)) {
  console.error(`og-card: no screenshot at ${source}`);
  process.exit(1);
}

const dataUri = (file, type) =>
  `data:${type};base64,${fs.readFileSync(file).toString("base64")}`;

// The site's own typeface, inlined: a page rendered from nothing cannot be
// trusted to fetch a font from disk, and a card set in a fallback would look
// like somebody else's.
const fonts = "docs/public/fonts";
const latin = dataUri(path.join(fonts, "inter-tight-latin.woff2"), "font/woff2");
const latinExt = dataUri(path.join(fonts, "inter-tight-latin-ext.woff2"), "font/woff2");

// The logo, as docs/app/components/Logo.vue draws it.
const logo = `
<svg viewBox="0 0 2481 1842" xmlns="http://www.w3.org/2000/svg" style="fill-rule:evenodd;clip-rule:evenodd">
  <g transform="matrix(1.003878,0,0,0.876822,668.314961,638.65748)">
    <path d="M1472.133,0L1685.165,0C1751.304,0 1805,61.477 1805,137.2L1805,1234.8C1805,1310.523 1751.304,1372 1685.165,1372L119.835,1372C53.696,1372 0,1310.523 0,1234.8L0,1024.831L1352.298,1024.831C1418.437,1024.831 1472.133,963.354 1472.133,887.631L1472.133,0Z" fill="currentColor" style="fill-opacity:.33"/>
  </g>
  <g transform="matrix(1.003878,0,0,0.876822,334.15748,334.251969)">
    <path d="M1472.133,0L1685.165,0C1751.304,0 1805,61.477 1805,137.2L1805,1234.8C1805,1310.523 1751.304,1372 1685.165,1372L119.835,1372C53.696,1372 0,1310.523 0,1234.8L0,990.792L1352.298,990.792C1418.437,990.792 1472.133,929.314 1472.133,853.592L1472.133,0Z" fill="currentColor" style="fill-opacity:.66"/>
  </g>
  <g transform="matrix(1.003878,0,0,0.876822,0,0)">
    <path d="M1805,137.2L1805,1234.8C1805,1310.523 1751.304,1372 1685.165,1372L119.835,1372C53.696,1372 0,1310.523 0,1234.8L0,137.2C0,61.477 53.696,0 119.835,0L1685.165,0C1751.304,0 1805,61.477 1805,137.2Z" fill="currentColor"/>
  </g>
</svg>`;

// Colours are the site's tokens (docs/app/assets/css/main.css).
const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
@font-face { font-family: "Inter Tight"; font-weight: 100 900; src: url(${latin}) format("woff2"); }
@font-face { font-family: "Inter Tight"; font-weight: 100 900; src: url(${latinExt}) format("woff2");
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+1E00-1E9F; }
* { box-sizing: border-box; margin: 0; }
html, body { width: 1200px; height: 630px; overflow: hidden; }
body { position: relative; background: #ffffff; font-family: "Inter Tight", sans-serif; color: #1c1c1e; }
.brand { position: absolute; left: 64px; top: 160px; display: flex; align-items: center; gap: 16px; }
.brand svg { width: 76px; height: 56px; color: #0066cc; }
.brand span { font-size: 30px; font-weight: 600; letter-spacing: -0.01em; }
.tagline { position: absolute; left: 64px; top: 251px; font-size: 21px; color: #4e4e52; }
h1 { position: absolute; left: 64px; top: 282px; width: 580px; font-size: 54px; line-height: 1.06;
     font-weight: 700; letter-spacing: -0.035em; }
.pills { position: absolute; left: 64px; top: 432px; display: flex; gap: 10px; }
.pills span { background: #e8e8ed; color: #1c1c1e; border-radius: 999px; padding: 6px 16px; font-size: 20px; }
.frame { position: absolute; left: 590px; top: 95px; width: 864px; height: 476px; overflow: hidden;
         border-radius: 20px; background: #f5f5f7;
         box-shadow: 0 0 0 1px rgba(0,0,0,.06), 0 25px 50px -12px rgba(0,0,0,.25); }
.frame img { display: block; width: 864px; }
</style></head><body>
  <div class="brand">${logo}<span>LokalBoards</span></div>
  <p class="tagline">Open-Source Kanban boards for teams</p>
  <h1>Where Humans &amp; Agents work together.</h1>
  <div class="pills"><span>MIT</span><span>Self-hosted</span><span>Made in Europe</span></div>
  <div class="frame"><img src="${dataUri(source, "image/png")}"></div>
</body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: output, clip: { x: 0, y: 0, width: 1200, height: 630 } });
  console.log(`og-card: ${output}`);
} finally {
  await browser.close();
}
