#!/usr/bin/env python3
"""Dump the Hermes bytecode string table as JSONL (one record per string)."""
import json
import sys
from pathlib import Path

from hermes_dec.parsers.hbc_file_parser import HBCReader


def main():
    if len(sys.argv) != 3:
        print("usage: extract_hermes_strings.py <bundle.hbc> <out.jsonl>", file=sys.stderr)
        return 1
    src, dst = sys.argv[1], sys.argv[2]
    Path(dst).parent.mkdir(parents=True, exist_ok=True)
    with open(src, "rb") as f:
        reader = HBCReader()
        reader.read_whole_file(f)
    count = 0
    with open(dst, "w", encoding="utf-8") as out:
        for i, s in enumerate(reader.strings):
            out.write(json.dumps({"i": i, "s": s}, ensure_ascii=False))
            out.write("\n")
            count += 1
    print(f"wrote {count} strings to {dst}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
