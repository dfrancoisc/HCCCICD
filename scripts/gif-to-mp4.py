#!/usr/bin/env python3
"""Produce an MP4 alongside each walkthrough GIF.

The GIFs are the source of truth — this only re-times them into video, so the
two can never drift apart. Frames are held by repetition at a fixed frame rate,
which keeps all the timing decisions in record-walkthrough.py.

    ./scripts/gif-to-mp4.py

Writes docs/img/<name>.mp4 for every GIF in docs/img.
"""

import os
import subprocess
import sys
import tempfile

from PIL import Image

FPS = 10
IMG_DIR = os.path.join("docs", "img")
ENCODER = os.path.join("scripts", "mp4encode.swift")


def convert(gif_path, tmp):
    name = os.path.splitext(os.path.basename(gif_path))[0]
    im = Image.open(gif_path)

    # H.264 requires even dimensions. The caption bar is at the bottom, so
    # trimming a row off the height is invisible.
    w = im.width - (im.width % 2)
    h = im.height - (im.height % 2)

    paths = []
    n = getattr(im, "n_frames", 1)
    for i in range(n):
        im.seek(i)
        # GIF frame durations are milliseconds; Pillow reports 0 for some
        # writers, so floor it at a readable minimum rather than dropping it.
        ms = im.info.get("duration") or 2000
        repeats = max(1, round(ms / 1000 * FPS))
        frame = im.convert("RGB").crop((0, 0, w, h))
        src = os.path.join(tmp, f"{name}-{i:03d}.png")
        frame.save(src)
        paths.extend([src] * repeats)

    out = os.path.join(IMG_DIR, f"{name}.mp4")
    subprocess.run(
        ["swift", ENCODER, out, str(w), str(h), str(FPS), *paths],
        check=True,
    )
    secs = len(paths) / FPS
    size = os.path.getsize(out) / 1_048_576
    print(f"  {name}.mp4  {w}x{h}  {secs:.0f}s  {size:.1f} MB")


def main():
    if not os.path.exists(ENCODER):
        sys.exit(f"missing {ENCODER} — run from the repository root")

    gifs = sorted(f for f in os.listdir(IMG_DIR) if f.endswith(".gif"))
    if not gifs:
        sys.exit(f"no GIFs in {IMG_DIR} — run scripts/record-walkthrough.py first")

    with tempfile.TemporaryDirectory(prefix="hcccicd-mp4-") as tmp:
        for g in gifs:
            convert(os.path.join(IMG_DIR, g), tmp)


if __name__ == "__main__":
    main()
