{
  description = "LokalBoards — self-hosted Kanban boards for teams";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      # The requester asked for these two; the rest come free because nothing
      # here is platform-specific — the build output is portable JavaScript.
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system:
        f (import nixpkgs { inherit system; }));
    in
    {
      packages = forAllSystems (pkgs: rec {
        lokalboards = pkgs.callPackage ./nix/package.nix { };
        default = lokalboards;
      });

      # `nix run github:florian-strasser/LokalBoards` — starts the server. It
      # still needs a database; the NixOS module below is what wires one up.
      apps = forAllSystems (pkgs: {
        default = {
          type = "app";
          program = "${self.packages.${pkgs.system}.lokalboards}/bin/lokalboards";
        };
      });

      # An overlay, for people who would rather have `pkgs.lokalboards` than
      # reach into this flake's outputs.
      overlays.default = final: _prev: {
        lokalboards = final.callPackage ./nix/package.nix { };
      };

      nixosModules = {
        lokalboards = { pkgs, ... }: {
          imports = [ ./nix/module.nix ];
          # The module itself takes no default: nothing guarantees that
          # `pkgs.lokalboards` exists on the system importing it. Here it does,
          # because it comes from this flake.
          services.lokalboards.package =
            nixpkgs.lib.mkDefault self.packages.${pkgs.stdenv.hostPlatform.system}.lokalboards;
        };
        default = self.nixosModules.lokalboards;
      };

      # The module, booted: a NixOS VM set up the way the guide describes and
      # put through what someone following it would try, reboot included. See
      # nix/test.nix. CI runs the x86_64-linux one; on a Mac the aarch64-darwin
      # one drives an aarch64 guest through a Linux builder.
      checks = forAllSystems (pkgs: {
        nixos-module = pkgs.testers.runNixOSTest (import ./nix/test.nix { inherit self; });
      });

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [ pkgs.nodejs_22 pkgs.mysql84 ];
        };
      });
    };
}
