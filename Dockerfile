# The Node every image runs, in the build and in the container itself. Keep it on
# the newest 22.x: a Node security release reaches the people running this image
# through this line or not at all.
ARG NODE_VERSION=22.23.4
ARG MYSQL_VERSION=8.4

# --- Build ---------------------------------------------------------------
#
# Pin the build stage to the *build* machine's architecture ($BUILDPLATFORM) so
# the toolchain (esbuild/Vite) runs natively instead of under QEMU emulation —
# emulating the amd64 esbuild on an arm64 host crashes it with random faults.
# Nuxt's .output is portable JavaScript, so the runtime stage below can still
# target a different architecture (e.g. linux/amd64) than the one we build on.
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-slim AS build

WORKDIR /app

# Copy the manifests first so this layer is cached unless dependencies change.
COPY ./package.json ./package-lock.json /app/

# Install exactly what the lockfile pins (reproducible), not a fresh resolve.
# The npm bundled with Node 22 (npm 10; it was 10.9.2 here) crashes on the current
# dependency tree with "Cannot read properties of null (reading 'edgesOut')" —
# an arborist bug fixed in npm 11 — and it also can't read a lockfile written by
# npm 11. Upgrade npm to match the lockfile's generator, then `npm ci`.
RUN npm install -g npm@11 && npm ci

COPY . ./

RUN npm run build

# sharp is a native module, and everything above ran on the machine doing the
# building — which is deliberately not the machine that will run this: the build
# stage is pinned to $BUILDPLATFORM while the runtime below targets
# $TARGETPLATFORM. Nitro copies node_modules into .output as it finds it, so
# without this the image ships a binary the runtime cannot load and every image
# upload fails.
#
# The target's copy is fetched in a directory of its own and swapped into the
# build output afterwards. Running `npm install --os/--cpu` inside the project
# instead re-resolves *every* optional dependency for that platform and strips
# the build machine's own native bindings — which breaks `npm run build` above,
# so this has to come after it and stay out of its way.
ARG TARGETARCH
RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) SHARP_CPU=x64 ;; \
      arm64) SHARP_CPU=arm64 ;; \
      *) echo "unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    mkdir -p /sharp && cd /sharp; \
    npm init -y >/dev/null; \
    npm install --no-save --os=linux --libc=glibc --cpu="${SHARP_CPU}" sharp; \
    rm -rf /app/.output/server/node_modules/@img /app/.output/server/node_modules/sharp; \
    cp -R /sharp/node_modules/@img /sharp/node_modules/sharp /app/.output/server/node_modules/; \
    ls /app/.output/server/node_modules/@img

# --- Runtime -------------------------------------------------------------
#
# Built on the official MySQL image rather than on Node, so the container can
# carry its own database and `docker run` works on a bare machine. That is the
# wrong way round for a Node app, but the database is the half with exacting
# requirements — a correct data directory, the right defaults, first-run
# initialisation — while Node is a self-contained tarball that drops onto any
# glibc.
#
# MySQL specifically, not MariaDB: the schema uses `utf8mb4_0900_ai_ci`, which
# only MySQL 8 has.
#
# The cost is size: this image is a few hundred MB rather than the ~80 MB a
# node:slim base gives, and every deployment pays it even when using an external
# database. The alternative — publishing two images — doubles the release
# surface and asks every reader to choose before they know what they want.
FROM mysql:${MYSQL_VERSION}

ARG NODE_VERSION
ARG TARGETARCH

# Node from the official tarball rather than a distribution package, so the
# version is exactly the one this app was built and tested against instead of
# whatever the base image's repository carries. The official builds target
# glibc 2.28, so they run on this base without a matching-distro build.
RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) NODE_ARCH=x64 ;; \
      arm64) NODE_ARCH=arm64 ;; \
      *) echo "unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" \
      -o /tmp/node.tar.xz; \
    tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
      --exclude=CHANGELOG.md --exclude=LICENSE --exclude=README.md; \
    rm -f /tmp/node.tar.xz; \
    node --version

WORKDIR /app

COPY --from=build /app/.output ./
COPY docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV HOST=0.0.0.0 \
    PORT=3000 \
    NODE_ENV=production \
    NODE_OPTIONS=--max-old-space-size=4096

# Uploads and database files both have to outlive the container. They are
# declared separately because they have different lifetimes in practice: a
# database can be rebuilt from a dump, uploaded files cannot be reconstructed
# from anything.
RUN mkdir -p /app/public/uploads && chown -R mysql:mysql /app/public/uploads
VOLUME ["/app/public/uploads", "/var/lib/mysql"]

# The container starts as root — the base image needs that to fix ownership on a
# freshly mounted data directory — and the entrypoint drops to the unprivileged
# `mysql` user before starting anything, using the `gosu` the base image already
# ships. That user owns both volumes above.
EXPOSE 3000

# Probes the app's health endpoint, which also checks database connectivity: an
# instance that cannot reach its database can serve nothing, and reporting it
# healthy would keep a broken container in a load balancer. The start period is
# generous because a first run initialises the MySQL data directory before the
# app can even begin its migrations.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "/app/server/index.mjs"]
