{ config, lib, pkgs, ... }:

let
  cfg = config.services.lokalboards;
  inherit (lib) mkIf mkOption mkEnableOption types mkDefault;
in
{
  options.services.lokalboards = {
    enable = mkEnableOption "LokalBoards, self-hosted Kanban boards";

    package = mkOption {
      type = types.package;
      description = ''
        The LokalBoards package to run. The flake's `nixosModules.lokalboards`
        fills this in from the same flake, so it only needs setting when the
        module is used on its own.
      '';
    };

    port = mkOption {
      type = types.port;
      default = 3000;
      description = "Port the server listens on.";
    };

    host = mkOption {
      type = types.str;
      default = "127.0.0.1";
      description = ''
        Address to bind. Left on loopback by default: the app speaks plain HTTP
        and belongs behind a reverse proxy that terminates TLS, rather than on a
        public interface. Its session cookie is marked `Secure` when
        `NUXT_BOARDS_URL` is an https address or the proxy sends
        `X-Forwarded-Proto: https`.
      '';
    };

    stateDir = mkOption {
      type = types.path;
      default = "/var/lib/lokalboards";
      description = ''
        Working directory of the service. Uploaded files live in
        `public/uploads` underneath it, because the application resolves them
        relative to its working directory and the Nix store is read-only.
      '';
    };

    database = {
      createLocally = mkOption {
        type = types.bool;
        default = true;
        description = ''
          Run a local MySQL for this instance and create the database in it.
          MySQL specifically, not MariaDB: the schema uses `utf8mb4_0900_ai_ci`,
          which only MySQL 8 provides.

          The database user is not created for you, because NixOS creates users
          that authenticate over the unix socket while this application connects
          over TCP with a password. Create it once, with the same password the
          `environmentFile` carries — for example through
          `services.mysql.initialScript`, a SQL file MySQL runs when it starts
          for the first time. It holds the password, so keep it outside the Nix
          store and readable by the `mysql` user:

          ```sql
          CREATE USER 'lokalboards'@'localhost' IDENTIFIED BY 'the-password';
          GRANT ALL PRIVILEGES ON lokalboards.* TO 'lokalboards'@'localhost';
          ```
        '';
      };

      host = mkOption {
        type = types.str;
        default = "127.0.0.1";
        description = "Database host, when not created locally.";
      };

      name = mkOption {
        type = types.str;
        default = "lokalboards";
        description = "Database name.";
      };

      user = mkOption {
        type = types.str;
        default = "lokalboards";
        description = "Database user.";
      };
    };

    environmentFile = mkOption {
      type = types.nullOr types.path;
      default = null;
      example = "/run/secrets/lokalboards.env";
      description = ''
        File of `KEY=value` lines read into the service's environment. This is
        where secrets belong — `NUXT_MYSQL_PASSWORD`, and any SSO client secret
        — because anything set through `settings` below lands in the Nix store,
        which is world-readable.
      '';
    };

    settings = mkOption {
      type = types.attrsOf types.str;
      default = { };
      example = {
        NUXT_APP_NAME = "Acme Boards";
        NUXT_LANGUAGE = "de";
      };
      description = ''
        Extra environment variables. Not for secrets — see `environmentFile`.
      '';
    };
  };

  config = mkIf cfg.enable {
    # The database is created, but the user is deliberately not: NixOS's
    # `ensureUsers` creates accounts that authenticate through the unix socket
    # with no password, and this application connects over TCP with one — it
    # passes host/user/password to mysql2 and never a socketPath — so such an
    # account could not log in. The credentials therefore have to be
    # provisioned once, which `initialScript` below is the place for.
    services.mysql = mkIf cfg.database.createLocally {
      enable = true;
      package = mkDefault pkgs.mysql84;
      ensureDatabases = [ cfg.database.name ];
    };

    assertions = [{
      assertion = cfg.environmentFile != null;
      message = ''
        services.lokalboards.environmentFile must be set: the application needs
        NUXT_MYSQL_PASSWORD, and a password does not belong in the Nix store.
      '';
    }];

    systemd.services.lokalboards = {
      description = "LokalBoards";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ] ++ lib.optional cfg.database.createLocally "mysql.service";
      requires = lib.optional cfg.database.createLocally "mysql.service";

      environment = {
        NODE_ENV = "production";
        HOST = cfg.host;
        PORT = toString cfg.port;
        NUXT_MYSQL_HOST = if cfg.database.createLocally then "127.0.0.1" else cfg.database.host;
        NUXT_MYSQL_USER = cfg.database.user;
        NUXT_MYSQL_DATABASE = cfg.database.name;
      } // cfg.settings;

      serviceConfig = {
        ExecStart = lib.getExe cfg.package;
        # The application resolves uploads as `process.cwd()/public/uploads`, so
        # the working directory — not the store path — is what has to be
        # writable.
        WorkingDirectory = cfg.stateDir;
        StateDirectory = "lokalboards";
        StateDirectoryMode = "0750";
        User = "lokalboards";
        Group = "lokalboards";
        DynamicUser = true;
        EnvironmentFile = lib.optional (cfg.environmentFile != null) cfg.environmentFile;
        Restart = "on-failure";

        # The service reads its own state directory and nothing else on disk.
        NoNewPrivileges = true;
        PrivateTmp = true;
        PrivateDevices = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        ProtectKernelTunables = true;
        ProtectKernelModules = true;
        ProtectControlGroups = true;
        RestrictAddressFamilies = [ "AF_INET" "AF_INET6" "AF_UNIX" ];
        RestrictNamespaces = true;
        LockPersonality = true;
        MemoryDenyWriteExecute = false; # V8 needs W^X for its JIT
        SystemCallArchitectures = "native";
      };

      preStart = ''
        mkdir -p ${cfg.stateDir}/public/uploads
      '';
    };
  };
}
