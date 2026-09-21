{ pkgs, ... }:

{
  packages = [
    pkgs.unzip
    pkgs.jq
    pkgs.ripgrep
    pkgs.fd
  ];

  languages.python = {
    enable = true;
    venv = {
      enable = true;
      requirements = ''
        hermes-dec==0.1.7
        graphql-core==3.2.6
      '';
    };
  };

  languages.javascript = {
    enable = true;
  };

  scripts = {
    extract-strings.exec = ''
      python scripts/extract_hermes_strings.py "$@"
    '';
    extract-graphql.exec = ''
      python scripts/extract_graphql.py "$@"
    '';
    extract-docnodes.exec = ''
      node scripts/extract_docnodes.mjs out/web/chunks > out/web/docnodes.jsonl && python scripts/extract_docnodes.py out/web/docnodes.jsonl out/web
    '';
    build-schema.exec = ''
      python scripts/build_schema.py out/web/graphql graphql/schema.graphql
    '';
  };

  enterShell = ''
    echo "toddle reverse-engineering env"
    echo "  extract-strings <bundle.hbc> <out.jsonl>    dump hermes string table"
    echo "  extract-graphql <strings.jsonl> <outdir>    pull graphql docs from strings"
    echo "  extract-docnodes                            re-extract web graphql documents"
    echo "  build-schema                                rebuild graphql/schema.graphql"
  '';
}
