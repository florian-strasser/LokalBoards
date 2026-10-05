# Contributing to LokalBoards

Thanks for your interest in improving LokalBoards! Contributions — bug reports,
fixes, features, and docs — are very welcome. This guide covers how to get a dev
environment running and what's expected of a pull request.

LokalBoards is a Nuxt 4 + Socket.IO, self-hosted Kanban app backed by MySQL.

## Prerequisites

- **Node.js 22** (the toolchain requires Node 20+; CI runs on 22).
- A reachable **MySQL 8+** database for local development. The required tables
  are created automatically on first start, so an empty database is enough.

## Getting started

```bash
git clone https://github.com/florian-strasser/LokalBoards
cd LokalBoards
npm install
```

Create a `.env.local` for local development (see the variables in the
[README](README.md#configure-environment-variables)), pointing
`NUXT_MYSQL_*` at your local database.

Run the dev server:

```bash
npx nuxt dev --dotenv .env.local
```

## Tests

There are two test suites:

- **Unit tests** — fast, no database required. This is what `npm test` runs and
  what gates every PR.

  ```bash
  npm test
  ```

- **Integration tests** — run the real code against a real MySQL. They live in
  `test/integration/` and use a **throwaway** database (they truncate tables, so
  never point them at real data). Create an empty database, then:

  ```bash
  TEST_MYSQL_HOST=127.0.0.1 \
  TEST_MYSQL_USER=root \
  TEST_MYSQL_PASSWORD=yourpassword \
  TEST_MYSQL_DATABASE=lokalboards_test \
  npm run test:integration
  ```

- **HTTP e2e tests** (`@nuxt/test-utils`) — build and run the real server and hit
  it over HTTP. Same `TEST_MYSQL_*` env as above, then `npm run test:e2e`.

- **Browser tests** (Playwright) — drive the real-time multiplayer UI in a real
  browser. One-time `npx playwright install chromium`, then build the app
  (`npm run build`) and run with the `TEST_MYSQL_*` env: `npm run test:browser`.

Please add or update tests for any behavior you change. Security-sensitive logic
(authorization, sessions, API keys) should keep its test coverage.

## Building

```bash
npm run build
```

### Building a Docker image

Only needed if you want to run your changes as a container; `npm run build` is
enough for development.

> **Build for the architecture you will run it on.** A plain `docker build`
> only produces your own machine's architecture, so an image built on an Apple
> Silicon Mac (`arm64`) fails on an `amd64` server with
> `exec ... : Exec format error`.

```bash
docker buildx build --platform linux/amd64 -t my-lokalboards:latest --load .
```

The `Dockerfile` pins its build stage to your machine's native architecture
(`--platform=$BUILDPLATFORM`) and only the runtime stage targets the platform
you ask for, so Vite and esbuild run natively rather than under QEMU — which
otherwise segfaults at random. Nuxt's `.output` is portable JavaScript, so the
image still runs on the target.

The official image is built and pushed by
[`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml)
when a `v*` tag is pushed. It is never published by hand.

## Database schema changes

The schema is managed by a small migration runner in
[`app/lib/databaseSetup.ts`](app/lib/databaseSetup.ts) and applied once at
startup. To change the schema, **append a new migration** to the `migrations`
array (e.g. `0002_add_x`) with an `up(db)` function — never edit or remove an
existing migration, as it may already be applied in the wild.

## Translations

The interface ships in ten languages. **Improving one you speak natively is a
genuinely useful pull request** — most of the current locales were translated
carefully but not reviewed by a native speaker, so tone and idiom are where they
are weakest. Fixing a handful of awkward strings is a perfectly good
contribution; you do not have to review a whole file.

Everything a language needs lives in four places:

1. `i18n/locales/<code>.json` — the ~320 interface strings.
2. `nuxt.config.ts` — one line in the `i18n.locales` array.
3. `server/utils/translations.ts` — a block of 16 e-mail strings.
4. `server/tasks/notification.ts` — the locale in `textList`, and a date locale
   (`cs` → `cs-CZ`) in `dateLocales`.

Two rules, both worth checking before you open the PR:

- **Keep the key set identical to `en.json`**, in the same order. A missing key
  falls back to English mid-sentence.
- **Keep every `{placeholder}` exactly as it appears in English.** They are
  substituted at runtime, so a dropped or renamed one ships a literal
  `{cardName}` into somebody's notification e-mail. This fails silently — the
  build will not catch it.

You can check both at once:

```bash
node -e "
const en = require('./i18n/locales/en.json');
const l  = require('./i18n/locales/YOUR_CODE.json');
const ph = s => (String(s).match(/\{[a-zA-Z]+\}/g) || []).sort().join();
const bad = Object.keys(en).filter(k => !(k in l) || ph(en[k]) !== ph(l[k]));
console.log(bad.length ? bad : 'ok');
"
```

Use the punctuation your language actually uses — the existing files do
(`«»` in Ukrainian, `„“` in Czech and German, `« »` in French). Leave
`systemActor` as `LokalBoards`; it is the product name, not a word.

## Pull request checklist

- [ ] `npm test` passes (and `npm run test:integration` if you touched DB code).
- [ ] `npm run build` succeeds.
- [ ] Added a `CHANGELOG.md` entry under the current unreleased version,
      describing the change and the why.
- [ ] New/changed behavior is covered by tests where practical.
- [ ] Code matches the style of the surrounding files.

CI runs the unit suite, a production build, an integration suite (against a
MySQL service container), an audit of the dependencies that ship in the image
(`npm run audit:shipped`, after a build), and CodeQL on every push and PR.

## Reporting security issues

Please do **not** open a public issue for security vulnerabilities. Follow the
process in [SECURITY.md](SECURITY.md).
