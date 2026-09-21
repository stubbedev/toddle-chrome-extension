#!/usr/bin/env python3
"""Generate extension icons (16/48/128 px) as plain PNGs, stdlib only.

Draws a rounded dark square with a light "T" — good enough until replaced
with real branding.
"""
import struct
import sys
import zlib
from pathlib import Path

BG = (30, 41, 59, 255)      # slate-800
FG = (226, 232, 240, 255)   # slate-200


def png_chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def render(size: int) -> bytes:
    px = [[BG for _ in range(size)] for _ in range(size)]
    r = max(2, size // 5)  # corner radius

    def inside(x: int, y: int) -> bool:
        cx = min(max(x, r), size - 1 - r)
        cy = min(max(y, r), size - 1 - r)
        return (x - cx) ** 2 + (y - cy) ** 2 <= r * r

    # "T" proportions
    bar_h = max(2, round(size * 0.18))
    stem_w = max(2, round(size * 0.16))
    bar_top = round(size * 0.22)
    stem_top = bar_top + bar_h
    stem_bottom = round(size * 0.78)
    bar_left = round(size * 0.20)
    bar_right = size - bar_left
    stem_left = (size - stem_w) // 2

    for y in range(size):
        for x in range(size):
            if not inside(x, y):
                px[y][x] = (0, 0, 0, 0)
                continue
            in_bar = (
                bar_top <= y < bar_top + bar_h
                and bar_left <= x < bar_right
            )
            in_stem = (
                stem_top <= y < stem_bottom and stem_left <= x < stem_left + stem_w
            )
            if in_bar or in_stem:
                px[y][x] = FG

    raw = b"".join(
        b"\x00" + b"".join(struct.pack("BBBB", *p) for p in row) for row in px
    )
    return (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + png_chunk(b"IDAT", zlib.compress(raw, 9))
        + png_chunk(b"IEND", b"")
    )


def main() -> int:
    outdir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("public/icons")
    outdir.mkdir(parents=True, exist_ok=True)
    for size in (16, 48, 128):
        path = outdir / f"icon{size}.png"
        path.write_bytes(render(size))
        print(f"wrote {path} ({path.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
