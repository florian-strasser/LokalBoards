#!/usr/bin/env bash
#
# One-command demo screenshots. Builds the app, spins up a throwaway seeded
# database and a server on a spare port (never :3000), and captures every page
# and modal in each configured language into demo-screenshots/<lang>/, plus a
# browsable index.html.
#
#   bash scripts/demo/run.sh            # or: npm run demo:screenshots
#
# Override anything via env:
#   DEMO_DB_HOST/USER/PASS/NAME   MySQL connection (default 127.0.0.1/root/root1234/lokalboards_demo)
#   DEMO_PORT                     server port (default 3100)
#   DEMO_LANGS                    space-separated locales (default "en de")
#   DEMO_OUT                      output dir (default demo-screenshots)
#   README_SHOT                   README screenshot written on each run
#                                 (default docs/public/images/readme-screenshot.webp)
#   README_SHOT_VIEW              which capture to use for it (default 26-modal-card)
#   HERO_SHOT                     homepage hero screenshot written on each run
#                                 (default docs/public/images/hero-screenshot.webp)
#   HERO_SHOT_VIEW                which capture to use for it (default 11-board-kanban)
#   HERO_SHOT_MOBILE              phone-shaped hero for the narrow homepage
#                                 (default docs/public/images/hero-screenshot-mobile.webp)
#   HERO_SHOT_MOBILE_VIEW         which capture to use for it (default 40-board-kanban-mobile)
#   DOCS_SHOTS_DIR                where the documentation guide's screenshots go
#                                 (default docs/public/images/docs)
#   SKIP_BUILD=1                  reuse the existing .output build
#   KEEP_DB=1                     don't drop the demo database at the end
set -euo pipefail
cd "$(dirname "$0")/../.."

# Match the project's Node (the shell may default to an older version).
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use 22 >/dev/null 2>&1 || true

DEMO_DB_HOST="${DEMO_DB_HOST:-127.0.0.1}"
DEMO_DB_USER="${DEMO_DB_USER:-root}"
DEMO_DB_PASS="${DEMO_DB_PASS:-root1234}"
DEMO_DB_NAME="${DEMO_DB_NAME:-lokalboards_demo}"
DEMO_PORT="${DEMO_PORT:-3100}"
DEMO_LANGS="${DEMO_LANGS:-en de}"
DEMO_OUT="${DEMO_OUT:-demo-screenshots}"
DEMO_TOKEN="${DEMO_TOKEN:-demo-token-alex}"
# The screenshot the README links to; refreshed from every run (needs cwebp).
README_SHOT="${README_SHOT:-docs/public/images/readme-screenshot.webp}"
# Which captured view to use for it. The open card fills the frame and shows
# description, checklist, attachments and the comment/activity timeline; the
# plain board leaves the lower half of the image empty.
README_SHOT_VIEW="${README_SHOT_VIEW:-26-modal-card}"
# The homepage hero wants the opposite of what the README wants: the board
# itself, so the first thing anyone sees is what LokalBoards looks like in use
# rather than one card's detail view. Taken whole, at the captured 16:10 — the
# demo board carries enough cards to fill it.
HERO_SHOT="${HERO_SHOT:-docs/public/images/hero-screenshot.webp}"
HERO_SHOT_VIEW="${HERO_SHOT_VIEW:-11-board-kanban}"
# The same hero, shot at phone proportions, for the narrow homepage.
HERO_SHOT_MOBILE="${HERO_SHOT_MOBILE:-docs/public/images/hero-screenshot-mobile.webp}"
HERO_SHOT_MOBILE_VIEW="${HERO_SHOT_MOBILE_VIEW:-40-board-kanban-mobile}"
# The guide's screenshots. These used to be exported by hand after a run, which
# is how a guide ends up illustrated with an interface from three releases ago;
# the mapping lives here now so every run refreshes them along with the rest.
# Format: <captured view>:<file name under DOCS_SHOTS_DIR>.
DOCS_SHOTS_DIR="${DOCS_SHOTS_DIR:-docs/public/images/docs}"
DOCS_SHOTS="
10-dashboard:dashboard
11-board-kanban:board-kanban
12-board-todo:board-todo
14-users:users
15-new-user:user-new
20-modal-create-board:board-create
23-modal-board-options:board-options
24-modal-invite:board-invite
25-modal-delete-board:board-archive
26-modal-card:card
27-modal-image-lightbox:card-lightbox
28-modal-delete-area:area-archive
30-search:search
31-menu-card:card-menu
32-menu-board-tile:board-tile-menu
33-modal-duplicate-board:board-duplicate
36-oauth-consent:oauth-consent
34-modal-archive:archive
35-board-filter:board-filter
"
export DEMO_DB_HOST DEMO_DB_USER DEMO_DB_PASS DEMO_DB_NAME DEMO_TOKEN
export DEMO_BASE_URL="http://127.0.0.1:${DEMO_PORT}"
export DEMO_LANGS

LOG="$(mktemp)"
SERVER_PID=""
mysql_do() { MYSQL_PWD="$DEMO_DB_PASS" mysql -h"$DEMO_DB_HOST" -u"$DEMO_DB_USER" "$@"; }

stop_server() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
    SERVER_PID=""
  fi
}
cleanup() {
  stop_server
  if [ "${KEEP_DB:-0}" != "1" ]; then
    mysql_do -e "DROP DATABASE IF EXISTS \`${DEMO_DB_NAME}\`;" 2>/dev/null || true
  fi
  rm -f "$LOG"
}
trap cleanup EXIT

start_server() { # $1 = language
  NUXT_MYSQL_HOST="$DEMO_DB_HOST" NUXT_MYSQL_USER="$DEMO_DB_USER" NUXT_MYSQL_PASSWORD="$DEMO_DB_PASS" \
  NUXT_MYSQL_DATABASE="$DEMO_DB_NAME" NUXT_MYSQL_SSL=false \
  NUXT_LANGUAGE="$1" NUXT_PUBLIC_SIGNUP=true NUXT_LOG_LEVEL=error \
  NUXT_BOARDS_URL="$DEMO_BASE_URL" \
  NUXT_OAUTH_ALLOW_INSECURE_CLIENT_METADATA=true \
  PORT="$DEMO_PORT" NITRO_PORT="$DEMO_PORT" \
    node .output/server/index.mjs >"$LOG" 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 1 60); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$DEMO_BASE_URL/" || true)"
    case "$code" in 200|302) return 0 ;; esac
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then echo "server exited early:"; cat "$LOG"; exit 1; fi
    sleep 1
  done
  echo "server did not become ready on :$DEMO_PORT"; cat "$LOG"; exit 1
}

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  echo "==> building app (SKIP_BUILD=1 to reuse the existing build)"
  npm run build
fi

echo "==> resetting demo database '$DEMO_DB_NAME'"
mysql_do -e "DROP DATABASE IF EXISTS \`${DEMO_DB_NAME}\`; CREATE DATABASE \`${DEMO_DB_NAME}\` CHARACTER SET utf8mb4;"

first=1
hero_done=0
for lang in $DEMO_LANGS; do
  echo "==> starting server (NUXT_LANGUAGE=$lang) on :$DEMO_PORT"
  start_server "$lang"
  if [ "$first" = "1" ]; then
    echo "==> seeding demo data"
    node scripts/demo/seed.mjs
    first=0
  fi
  echo "==> capturing screenshots -> $DEMO_OUT/$lang"
  mkdir -p "$DEMO_OUT/$lang"
  node scripts/demo/screenshots.mjs "$DEMO_OUT/$lang"

  # The README's and the homepage's screenshots are both among these captures,
  # so neither can go stale: every run refreshes them from the first language's.
  if [ "$hero_done" != "1" ]; then
    if command -v cwebp >/dev/null 2>&1; then
      if [ -f "$DEMO_OUT/$lang/$README_SHOT_VIEW.png" ]; then
        echo "==> refreshing README screenshot -> $README_SHOT"
        cwebp -quiet -q 82 -resize 1440 0 "$DEMO_OUT/$lang/$README_SHOT_VIEW.png" -o "$README_SHOT"
      fi
      if [ -f "$DEMO_OUT/$lang/$HERO_SHOT_VIEW.png" ]; then
        echo "==> refreshing hero screenshot -> $HERO_SHOT"
        cwebp -quiet -q 82 -resize 1440 0 "$DEMO_OUT/$lang/$HERO_SHOT_VIEW.png" -o "$HERO_SHOT"
        # The narrower widths the page offers through `srcset`, so a phone does
        # not download a 1440-wide picture to paint 400 of it.
        for _w in 720 1024; do
          cwebp -quiet -q 82 -resize "$_w" 0 "$DEMO_OUT/$lang/$HERO_SHOT_VIEW.png" \
            -o "${HERO_SHOT%.webp}-${_w}.webp"
        done
      fi
      if [ -f "$DEMO_OUT/$lang/$HERO_SHOT_MOBILE_VIEW.png" ]; then
        echo "==> refreshing mobile hero screenshot -> $HERO_SHOT_MOBILE"
        # Trimmed from the top rather than shipped at the phone's own 1:2.2. A
        # full-height screenshot fills the whole viewport in the hero, and the
        # bytes for the last stretch of it are spent on something nobody scrolls
        # to; 1:1.9 keeps the picture tall enough to read as a phone while
        # taking about a tenth off the bottom. Derived from the capture, so it
        # survives a change of device size.
        _mw=$(sips -g pixelWidth "$DEMO_OUT/$lang/$HERO_SHOT_MOBILE_VIEW.png" | awk '/pixelWidth/{print $2}')
        _mh=$(( _mw * 19 / 10 ))
        cwebp -quiet -q 82 -crop 0 0 "$_mw" "$_mh" -resize 786 0 \
          "$DEMO_OUT/$lang/$HERO_SHOT_MOBILE_VIEW.png" -o "$HERO_SHOT_MOBILE"
        cwebp -quiet -q 82 -crop 0 0 "$_mw" "$_mh" -resize 590 0 \
          "$DEMO_OUT/$lang/$HERO_SHOT_MOBILE_VIEW.png" -o "${HERO_SHOT_MOBILE%.webp}-590.webp"
      fi
      echo "==> refreshing the guide's screenshots -> $DOCS_SHOTS_DIR"
      mkdir -p "$DOCS_SHOTS_DIR"
      for _pair in $DOCS_SHOTS; do
        _view="${_pair%%:*}"
        _name="${_pair##*:}"
        if [ -f "$DEMO_OUT/$lang/$_view.png" ]; then
          cwebp -quiet -q 82 -resize 1440 0 "$DEMO_OUT/$lang/$_view.png" \
            -o "$DOCS_SHOTS_DIR/$_name.webp"
        else
          echo "    missing capture: $_view (guide image $_name.webp left as it was)"
        fi
      done

      hero_done=1
    else
      echo "==> skipping screenshot refresh: cwebp not installed (brew install webp)"
    fi
  fi
  stop_server
done

node scripts/demo/gallery.mjs "$DEMO_OUT"
echo "==> done. open $DEMO_OUT/index.html"
