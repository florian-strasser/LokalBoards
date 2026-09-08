{ lib
, stdenv
, importNpmLock
, nodejs_22
, nodejs_24
, makeWrapper
}:

stdenv.mkDerivation (finalAttrs: {
  pname = "lokalboards";
  # Taken from package.json rather than written here, so `npm version` stays the
  # single place a release number is set and the two cannot drift apart.
  version = (lib.importJSON ../package.json).version;

  src = lib.cleanSourceWith {
    src = ../.;
    # Keep the store path free of things the build never reads. `tests/` and
    # `scripts/` are the bulk of it, and both pull the whole demo apparatus in.
    filter = path: type:
      let rel = lib.removePrefix (toString ../. + "/") (toString path);
      in !(lib.hasPrefix "tests/" rel
        || lib.hasPrefix "scripts/" rel
        || lib.hasPrefix "docs/" rel
        || lib.hasPrefix "demo-screenshots/" rel
        || lib.hasPrefix "portfolio-screenshots/" rel
        || lib.hasPrefix ".output/" rel
        || lib.hasPrefix "node_modules/" rel
        || lib.hasPrefix ".git/" rel);
  };

  # Dependencies come from the lockfile itself, with no hash of their own to
  # keep in step with it.
  #
  # This was tried once before and abandoned: `importNpmLock` used to cache
  # tarballs but not registry metadata, npm would ask the registry about
  # `minimatch` — `archiver-utils` wants ^9 and `readdir-glob` wants ^5 while
  # the lockfile pins one copy — and the sandboxed install died with ENOTCACHED.
  # It builds this lockfile now, so the aggregate hash `fetchNpmDeps` needs is
  # gone with it. That matters more than the convenience: the hash described the
  # lockfile at one moment in time and nothing made the two move together, so a
  # dependency change silently broke `nix build` until somebody tried it. This
  # cannot drift, because there is nothing left to drift from — the lockfile is
  # read directly, and every package is fetched by the integrity field already
  # written beside it.
  #
  # `npmRoot` is the filtered source above rather than the directory this file
  # sits in, so the lockfile used is the very one that goes into the build.
  npmDeps = importNpmLock.buildNodeModules {
    npmRoot = finalAttrs.src;
    nodejs = nodejs_24;
  };

  # Built with Node 24 for its npm 11, and *run* on Node 22 (see the wrapper
  # below). package-lock.json is written by npm 11, and npm 10 — which is what
  # nodejs_22 carries — rejects it as out of sync: "Missing: minimatch@5.1.9",
  # "Missing: unplugin@3.3.0", because the two npms disagree about optional
  # peer dependencies. npm then falls back to resolving against the registry,
  # which a sandboxed build has no access to, and dies with ENOTCACHED. The
  # Dockerfile solves the same problem by installing npm 11 over the image's
  # npm 10. Only the build toolchain differs; Nuxt's output is portable JS.
  nativeBuildInputs = [ nodejs_24 makeWrapper ];

  # The dependency tree is copied into place rather than installed or symlinked.
  #
  # Not installed, because `npm ci` re-resolves and reaches for the registry,
  # which a sandboxed build cannot do — that is the ENOTCACHED failure this
  # package kept running into.
  #
  # Not symlinked (`importNpmLock.linkNodeModulesHook`) either: Nitro copies
  # dependencies into `.output/server/node_modules` as it builds, and a tree
  # pointing back at the read-only store fails that with EACCES.
  #
  # Copying costs a little disk in the sandbox and sidesteps both. The old
  # `--ignore-scripts` goes with the install step: nothing runs a postinstall
  # now, and `npm run build` does the `nuxt prepare` that one would have.
  configurePhase = ''
    runHook preConfigure
    cp -r ${finalAttrs.npmDeps}/node_modules ./node_modules
    chmod -R u+w ./node_modules
    export PATH="$PWD/node_modules/.bin:$PATH"
    runHook postConfigure
  '';

  # Nuxt phones home on build unless told not to. There is no network in the
  # sandbox, so this is the difference between a clean build and a wait for a
  # connection that cannot happen.
  env.NUXT_TELEMETRY_DISABLED = "1";

  buildPhase = ''
    runHook preBuild
    npm run build
    runHook postBuild
  '';

  # Nuxt's .output is self-contained: the server bundle, its dependencies and
  # the built client assets. Nothing from node_modules is needed at runtime, so
  # only .output goes to the store.
  installPhase = ''
    runHook preInstall

    mkdir -p $out/share/lokalboards
    cp -r .output/* $out/share/lokalboards/

    # Uploads are resolved from the process's working directory
    # (process.cwd() + /public/uploads, in seven places), and the store is
    # read-only — so the wrapper deliberately does NOT set a working directory.
    # Whoever starts it chooses a writable one; the NixOS module points it at
    # /var/lib/lokalboards.
    makeWrapper ${nodejs_22}/bin/node $out/bin/lokalboards \
      --add-flags "$out/share/lokalboards/server/index.mjs" \
      --set-default NODE_ENV production

    runHook postInstall
  '';

  meta = {
    description = "Self-hosted Kanban boards for teams, with realtime updates, SSO and an API";
    homepage = "https://github.com/florian-strasser/LokalBoards";
    license = lib.licenses.mit;
    mainProgram = "lokalboards";
    platforms = lib.platforms.unix;
  };
})
