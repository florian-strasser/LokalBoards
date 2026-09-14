# The NixOS module, booted.
#
# One machine, set up the way the guide at lokalboards.com/docs#nix-and-nixos
# describes it: the module with its local MySQL, the database user from an
# `initialScript` kept outside the store and readable by `mysql`, secrets in an
# environment file, and nginx in front with websockets and a raised upload
# limit. test.py then does what somebody following the guide would do to find
# out whether it worked, reboots, and checks it all came back.
#
#   nix build .#checks.x86_64-linux.nixos-module     Linux with KVM, as CI runs it
#   nix build .#checks.aarch64-darwin.nixos-module   a Mac with a Linux builder
{ self }:
{
  name = "lokalboards-nixos-module";

  nodes.machine =
    { config, lib, pkgs, ... }:
    {
      imports = [ self.nixosModules.default ];

      virtualisation = {
        memorySize = 3072;
        cores = 2;
        diskSize = 4096;
        # nixpkgs starts VMs on a Mac with `gic-version=2`, which QEMU 11 refuses
        # under Apple's hypervisor. A later -machine flag overrides that one
        # property; on Linux there is nothing to override.
        qemu.options = lib.optional config.virtualisation.host.pkgs.stdenv.hostPlatform.isDarwin "-machine gic-version=3";
      };

      services.lokalboards = {
        enable = true;
        environmentFile = "/etc/lokalboards/lokalboards.env";
        settings = {
          NUXT_APP_NAME = "Module test";
          NUXT_BOARDS_URL = "http://machine";
        };
      };

      services.mysql.initialScript = "/etc/lokalboards/init.sql";

      # Stand-ins for /run/secrets: files at paths outside the store, owned the
      # way the guide says. Their contents come from the store all the same,
      # which is fine for a test and for nothing else.
      environment.etc."lokalboards/init.sql" = {
        mode = "0400";
        user = "mysql";
        text = ''
          CREATE USER 'lokalboards'@'localhost' IDENTIFIED BY 'test-password';
          GRANT ALL PRIVILEGES ON lokalboards.* TO 'lokalboards'@'localhost';
        '';
      };
      environment.etc."lokalboards/lokalboards.env" = {
        mode = "0400";
        text = ''
          NUXT_MYSQL_PASSWORD=test-password
          NUXT_ADMIN_EMAIL=admin@example.test
          NUXT_ADMIN_PASSWORD=test-admin-password
        '';
      };

      services.nginx = {
        enable = true;
        recommendedProxySettings = true;
        clientMaxBodySize = "50m";
        virtualHosts.default = {
          default = true;
          locations."/" = {
            proxyPass = "http://127.0.0.1:3000";
            proxyWebsockets = true;
          };
        };
      };

      environment.systemPackages = [ pkgs.curl ];
    };

  testScript = builtins.readFile ./test.py;
}
