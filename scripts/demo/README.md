# Demo screenshots

Generates a fresh, fully-seeded demo instance and captures a screenshot of every
page and modal in each language — useful for docs, release notes, or a quick
visual regression check.

## Usage

```bash
npm run demo:screenshots
# or
bash scripts/demo/run.sh
```

Output lands in `demo-screenshots/<lang>/*.png` with a browsable
`demo-screenshots/index.html` pairing the languages side by side.
(`demo-screenshots/` is gitignored.)

## Requirements

- A local MySQL you can create/drop a throwaway database on
  (defaults to `127.0.0.1`, `root`/`root1234`).
- Playwright's Chromium (already installed for the e2e tests; otherwise
  `npx playwright install chromium`).

The build runs on a spare port (`3100` by default) — it never touches `:3000`.

## What it does

1. `npm run build` (skip with `SKIP_BUILD=1`).
2. Drops + recreates the demo database.
3. For each language: starts the built server with `NUXT_LANGUAGE=<lang>`
   (seeding the data on the first run), then drives Chromium as the seeded admin
   (via the `session_token` cookie) through every page and modal.
4. From the first language's captures, refreshes the images the website and the
   README use (needs `cwebp`): the README screenshot, the homepage hero at
   every width it is served in, the guide's screenshots in
   `docs/public/images/docs`, and the social preview card
   `docs/public/images/og-card.png`.
5. Writes the gallery `index.html` and drops the demo database.

## Configuration (env vars)

| Var | Default | Meaning |
|-----|---------|---------|
| `DEMO_LANGS` | `en de` | Space-separated locales to capture |
| `DEMO_PORT` | `3100` | Server port |
| `DEMO_OUT` | `demo-screenshots` | Output directory |
| `DEMO_DB_HOST` / `DEMO_DB_USER` / `DEMO_DB_PASS` / `DEMO_DB_NAME` | `127.0.0.1` / `root` / `root1234` / `lokalboards_demo` | MySQL connection |
| `SKIP_BUILD` | `0` | Reuse the existing `.output` build |
| `KEEP_DB` | `0` | Keep the demo database instead of dropping it |

## Files

- `run.sh` — orchestrator (build → DB → per-language server + capture → gallery).
- `seed.mjs` — inserts the placeholder users/boards/cards/comments/attachment.
  Refuses to run unless the database name looks like a throwaway (`demo`/`test`).
- `screenshots.mjs` — the Playwright capture (pages + modals).
- `gallery.mjs` — builds the side-by-side `index.html`.
- `og-card.mjs` — renders the 1200 × 630 social preview card from the board
  capture, in the website's typeface and colours.
- `mockup.png` — the demo image attachment.

To add a view, add one `shot(...)` call in `screenshots.mjs` and a matching row
in `gallery.mjs`.
