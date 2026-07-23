#!/usr/bin/env python3
"""Record the animated walkthroughs used in the README.

Drives the tool through its ?demo= deep links with headless Chrome, captures a
full-resolution frame per state, adds a caption bar, and assembles animated
GIFs. No ffmpeg or browser-automation dependency — Chrome's --screenshot and
Pillow are enough, and both are already on a normal Mac.

    ./scripts/record-walkthrough.py [--host http://localhost:22773]

Writes docs/img/walkthrough.gif and docs/img/recovery.gif.
"""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

SHOT_W, SHOT_H = 1400, 900
OUT_W = 1000                      # width of the finished GIF
BAR_H = 78                        # caption bar
BG = (11, 13, 17)
BAR_BG = (16, 20, 26)
RULE = (28, 33, 40)
FG = (230, 232, 235)
MUTED = (139, 147, 161)
ACCENT = (124, 116, 255)

# state, seconds on screen, step label, caption
WALKTHROUGH = [
    ("workspace",   3.0, "1",  "Start a change. You get a private copy of the configuration and a hold on everything you touch."),
    ("changes",     3.5, "2",  "Build the way you always do. Every save is captured and versioned on its own — no export step."),
    ("promote1",    3.0, "3",  "Describe what changed and why. The approver reads this, so it is mandatory."),
    ("promote2",    3.0, "4",  "Tick what goes forward. Five of the sixteen items — and she would have sent exactly this."),
    ("promote3",    4.5, "5",  "The safety check follows every reference. Five problems would have broken Test."),
    ("promote3fix", 4.5, "5",  "One click each, and it re-runs. Five items became eleven — six would have been missed."),
    ("settings",    4.5, "5",  "Development values stay in development. Four settings have no value in Test at all."),
    ("promote4",    3.5, "6",  "Review. Nothing has moved yet."),
    ("submitted",   3.5, "6",  "Submitted. Twelve items on their way to Test."),
    ("requests",    4.0, "7",  "Track every change. Deployed, waiting for approval, or sent back with a reason."),
    ("environments",3.5, "8",  "The route a change takes, and who has to sign off at each stop."),
]

RECOVERY = [
    ("orphans",     4.0, "1",  "Built before starting a change? Nothing is lost — every save was captured anyway."),
    ("collision",   5.0, "2",  "But nothing was holding those items, and somebody else edited the same one."),
    ("adopted",     4.0, "3",  "Tick what belongs together, give it a reference — and it becomes a proper change."),
]

# The editor-side onboarding. Recorded against scripts/harness/editor.html, a
# stand-in for the shipped Interoperability page: the real one needs a signed-in
# session that headless Chrome has no way to obtain. The injected bar, tab and
# guide are the genuine article — only the page underneath them is a stand-in.
ONBOARDING = [
    ("nochange", 6.0, "1", "Land in the Interoperability editor with nothing started, and the guide comes to you."),
    ("nochange", 4.0, "2", "Four steps, and the warning that matters: start the change before you build, not after."),
    ("open",     4.5, "3", "Once a change is open the guide stops. A quiet strip confirms you are covered."),
]

STATE_NOCHANGE = '{"workspace":null,"changes":[],"orphans":[]}'
STATE_OPEN = ('{"workspace":{"ref":"INT-5001","title":"Lab results feed"},'
              '"changes":[{"key":"a"},{"key":"b"},{"key":"c"}],"orphans":[]}')


def font(size, bold=False):
    for path in (
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ):
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                pass
    return ImageFont.load_default()


def shoot(url, out_path):
    subprocess.run(
        [CHROME, "--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
         f"--window-size={SHOT_W},{SHOT_H}", "--virtual-time-budget=5000",
         f"--screenshot={out_path}", url],
        check=True, capture_output=True,
    )


def wrap(draw, text, fnt, max_w):
    words, lines, cur = text.split(), [], ""
    for w in words:
        probe = (cur + " " + w).strip()
        if draw.textlength(probe, font=fnt) <= max_w:
            cur = probe
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def caption(img, step, text):
    """Scale the screenshot and stack a caption bar underneath it."""
    scale = OUT_W / img.width
    img = img.convert("RGB").resize((OUT_W, round(img.height * scale)), Image.LANCZOS)

    out = Image.new("RGB", (OUT_W, img.height + BAR_H), BAR_BG)
    out.paste(img, (0, 0))
    d = ImageDraw.Draw(out)
    d.line([(0, img.height), (OUT_W, img.height)], fill=RULE, width=1)

    top = img.height
    f_step = font(13, bold=True)
    f_text = font(15)

    # step chip
    cx, cy, r = 30, top + BAR_H // 2, 13
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=ACCENT)
    sw = d.textlength(step, font=f_step)
    d.text((cx - sw / 2, cy - 8), step, font=f_step, fill=(255, 255, 255))

    lines = wrap(d, text, f_text, OUT_W - 80)
    lh = 21
    ty = cy - (len(lines) * lh) // 2 - 1
    for i, line in enumerate(lines):
        d.text((54, ty + i * lh), line, font=f_text, fill=FG if i == 0 else MUTED)
    return out


def harness_url(host, state, i):
    """Editor-onboarding frames run against the harness page, not the tool."""
    import urllib.parse
    payload = STATE_OPEN if state == "open" else STATE_NOCHANGE
    # Frame 2 re-shoots the same screen; vary t so Chrome does not serve a
    # cached render and the localStorage "seen" flag starts clean each time.
    return (f"{host}/hcccicd/harness.html?state={urllib.parse.quote(payload)}&t={i}")


def build(host, frames, out_file, tmp):
    imgs, durations = [], []
    onboarding = out_file == "onboarding.gif"
    for i, (state, secs, step, text) in enumerate(frames):
        if onboarding:
            url = harness_url(host, state, i)
        else:
            fresh = "&fresh=1" if state in ("orphans", "collision", "adopted") else ""
            url = f"{host}/hcccicd/index.html?demo={state}{fresh}&t={i}"
        raw = os.path.join(tmp, f"{out_file}-{i:02d}.png")
        print(f"  [{i + 1}/{len(frames)}] {state}")
        shoot(url, raw)
        imgs.append(caption(Image.open(raw), step, text))
        durations.append(int(secs * 1000))

    # One adaptive palette derived from every frame at once. Quantising each
    # frame independently gives the dark UI a slightly different palette per
    # frame, which reads as flicker on playback.
    h = imgs[0].height
    merged = Image.new("RGB", (imgs[0].width, h * len(imgs)))
    for i, im in enumerate(imgs):
        merged.paste(im, (0, i * h))
    pal_img = merged.quantize(colors=128, method=Image.MEDIANCUT)

    quantized = [im.quantize(palette=pal_img, dither=Image.FLOYDSTEINBERG) for im in imgs]

    path = os.path.join("docs", "img", out_file)
    quantized[0].save(path, save_all=True, append_images=quantized[1:],
                      duration=durations, loop=0, optimize=True, disposal=2)
    print(f"  -> {path}  ({os.path.getsize(path) / 1_048_576:.1f} MB)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="http://localhost:22773")
    args = ap.parse_args()

    if not os.path.exists(CHROME):
        sys.exit(f"Google Chrome not found at {CHROME}")
    os.makedirs(os.path.join("docs", "img"), exist_ok=True)

    tmp = tempfile.mkdtemp(prefix="hcccicd-frames-")
    try:
        print("Recording onboarding.gif")
        print("  (needs scripts/harness/editor.html deployed as /hcccicd/harness.html —")
        print("   ./scripts/deploy.sh --with-harness puts it there and takes it away after)")
        build(args.host, ONBOARDING, "onboarding.gif", tmp)
        print("Recording walkthrough.gif")
        build(args.host, WALKTHROUGH, "walkthrough.gif", tmp)
        print("Recording recovery.gif")
        build(args.host, RECOVERY, "recovery.gif", tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
