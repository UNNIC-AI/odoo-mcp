{
  description = "MCP server for Odoo ERP — standard XML-RPC, no addons required";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forAllSystems (pkgs: rec {
        odoo-mcp = pkgs.buildNpmPackage {
          pname = "odoo-mcp";
          inherit ((builtins.fromJSON (builtins.readFile ./package.json))) version;

          src = ./.;

          npmDepsHash = "sha256-J/evlW9ak1o9mdjYWm6N9lphKZGFkXRMUaz7dLrgZwM=";

          nodejs = pkgs.nodejs_22;

          # Las unitarias no necesitan red ni Odoo, así que pueden correr
          # dentro del sandbox. Las de integración quedan fuera a propósito.
          doCheck = true;
          checkPhase = ''
            runHook preCheck
            npm run typecheck
            npm test
            runHook postCheck
          '';

          meta = {
            description = "MCP server for Odoo ERP over XML-RPC";
            homepage = "https://github.com/unnic-ai/odoo-mcp";
            license = pkgs.lib.licenses.mit;
            mainProgram = "odoo-mcp";
          };
        };

        default = odoo-mcp;
      });

      apps = forAllSystems (pkgs: rec {
        odoo-mcp = {
          type = "app";
          program = nixpkgs.lib.getExe self.packages.${pkgs.system}.odoo-mcp;
        };
        default = odoo-mcp;
      });

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_22
            pkgs.prefetch-npm-deps
          ];
        };
      });

      formatter = forAllSystems (pkgs: pkgs.nixfmt-tree);
    };
}
