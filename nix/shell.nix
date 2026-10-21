{
  perSystem =
    { lib, pkgs, ... }:
    let
      python = pkgs.python3;
      nodejs = pkgs.nodejs;

      requirements = pkgs.writeText "requirements.txt" ''
        hermes-dec==0.1.7
        graphql-core==3.2.6
      '';

      # Both store paths are content-addressed by what they hold, so the
      # venv is rebuilt exactly when the interpreter or the pins change.
      venvKey = pkgs.writeText "venv-key" "${python}\n${requirements}\n";

      # Prints the venv path; everything else goes to stderr so the
      # shellHook can capture it.
      syncVenv = pkgs.writeShellApplication {
        name = "sync-venv";
        runtimeInputs = [
          pkgs.git
          pkgs.diffutils
        ];
        text = ''
          venv="$(git rev-parse --show-toplevel)/.venv"
          if ! cmp -s "$venv/.nix-key" ${venvKey}; then
            rm -rf "$venv"
            ${python.interpreter} -m venv "$venv"
            "$venv/bin/pip" install --quiet --disable-pip-version-check --requirement ${requirements} >&2
            cp ${venvKey} "$venv/.nix-key"
          fi
          printf '%s\n' "$venv"
        '';
      };

      # Every command resolves paths from the repo root, so it works from
      # any subdirectory.
      mkScript =
        name: runtimeInputs: body:
        pkgs.writeShellApplication {
          inherit name;
          runtimeInputs = [ pkgs.git ] ++ runtimeInputs;
          text = ''
            root="$(git rev-parse --show-toplevel)"
            ${body}
          '';
        };
      venvPython = ''"$root/.venv/bin/python"'';
    in
    {
      devShells.default = pkgs.mkShell {
        packages = [
          pkgs.unzip
          pkgs.jq
          pkgs.ripgrep
          pkgs.fd
          python
          pkgs.pyright
          nodejs
          pkgs.typescript-language-server

          (mkScript "extract-strings" [ ] ''
            ${venvPython} "$root/scripts/extract_hermes_strings.py" "$@"
          '')
          (mkScript "extract-graphql" [ ] ''
            ${venvPython} "$root/scripts/extract_graphql.py" "$@"
          '')
          (mkScript "extract-docnodes" [ nodejs ] ''
            node "$root/scripts/extract_docnodes.mjs" "$root/out/web/chunks" > "$root/out/web/docnodes.jsonl"
            ${venvPython} "$root/scripts/extract_docnodes.py" "$root/out/web/docnodes.jsonl" "$root/out/web"
          '')
          (mkScript "build-schema" [ ] ''
            ${venvPython} "$root/scripts/build_schema.py" "$root/out/web/graphql" "$root/graphql/schema.graphql"
          '')
          (mkScript "ext-build" [ nodejs ] ''
            cd "$root/extension"
            npm run build
          '')
          (mkScript "ext-dev" [ nodejs ] ''
            cd "$root/extension"
            npm run dev
          '')
        ];

        shellHook = ''
          venv="$(${lib.getExe syncVenv})" || exit 1
          source "$venv/bin/activate"
          unset venv
        '';
      };

      formatter = pkgs.nixfmt;
    };
}
