#!/usr/bin/env python3
"""Extract GraphQL documents from a JSONL string dump.

usage: extract_graphql.py <strings.jsonl> <outdir>
"""
import codecs
import json
import re
import sys
from pathlib import Path

from graphql import parse, OperationDefinitionNode, FragmentDefinitionNode

CANDIDATE = re.compile(r"\A\s*(query|mutation|subscription|fragment|\{)", re.IGNORECASE)


def try_parse(text):
    try:
        ast = parse(text)
        return ast
    except Exception:
        return None


def unescape(text):
    try:
        return codecs.decode(text, "unicode_escape")
    except Exception:
        return None


def main():
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 1
    src, outdir = Path(sys.argv[1]), Path(sys.argv[2])
    outdir.mkdir(parents=True, exist_ok=True)
    graphql_dir = outdir / "graphql"
    graphql_dir.mkdir(exist_ok=True)

    manifest = []
    seen = {}
    stats = {"candidates": 0, "parsed": 0, "dupes": 0}

    with open(src, encoding="utf-8") as f:
        for line in f:
            rec = json.loads(line)
            s = rec["s"]
            if len(s) < 10 or "{" not in s or not CANDIDATE.match(s):
                continue
            stats["candidates"] += 1

            text = s
            ast = try_parse(text)
            if ast is None:
                alt = unescape(s)
                if alt and alt is not s:
                    alt_ast = try_parse(alt)
                    if alt_ast is not None:
                        text, ast = alt, alt_ast
            if ast is None:
                continue

            defs = [
                d for d in ast.definitions
                if isinstance(d, (OperationDefinitionNode, FragmentDefinitionNode))
            ]
            if not defs or len(defs) != len(ast.definitions):
                continue

            stats["parsed"] += 1
            key = " ".join(sorted(
                (d.name.value if d.name else "?") + ":" +
                ("fragment" if isinstance(d, FragmentDefinitionNode) else d.operation.value)
                for d in defs
            )) + "|" + re.sub(r"\s+", " ", text).strip()
            if key in seen:
                stats["dupes"] += 1
                continue
            seen[key] = rec["i"]

            entry = {"string_index": rec["i"], "definitions": [], "file": None}
            for d in defs:
                if isinstance(d, FragmentDefinitionNode):
                    kind, name = "fragment", d.name.value
                else:
                    kind = d.operation.value
                    name = d.name.value if d.name else f"anonymous_{rec['i']}"
                safe = re.sub(r"[^A-Za-z0-9_]+", "_", name).strip("_")
                fname = f"{safe}.{kind}.graphql"
                path = graphql_dir / fname
                if path.exists():
                    n = 2
                    while (graphql_dir / f"{safe}__{n}.{kind}.graphql").exists():
                        n += 1
                    fname = f"{safe}__{n}.{kind}.graphql"
                    path = graphql_dir / fname
                path.write_text(text, encoding="utf-8")
                entry["definitions"].append({"kind": kind, "name": name})
                if entry["file"] is None:
                    entry["file"] = fname
                else:
                    entry["file"] += "," + fname
            manifest.append(entry)

    (outdir / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(json.dumps(stats, indent=2))
    print(f"manifest: {outdir / 'manifest.json'} ({len(manifest)} documents)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
