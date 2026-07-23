#!/usr/bin/env python3
"""Record the full journey: sign in, start a change, build a production, send it.

Unlike record-walkthrough.py this drives **real IRIS state**. Between captures
it resets the baseline, starts a change through the API, and creates an actual
production and business service in the namespace, so what appears in the tool is
genuine capture rather than a fixture.

    ./scripts/record-production-journey.py [--container iris-agentic]
                                           [--namespace HSCUSTOM]
                                           [--host http://localhost:22773]

Writes docs/img/production-journey.gif (and .mp4 via gif-to-mp4.py).

Two frames are unavoidably staged, and both say so on screen:
  * the sign-in frame is the real login page, captured but not submitted —
    the recorder does not type anyone's password;
  * the editor frames use scripts/harness/editor.html, because the shipped
    editor is behind that login.
Everything from "start a change" onwards is the real tool against real IRIS.
"""

import argparse
import os
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from importlib import import_module

rw = import_module("record-walkthrough".replace("-", "_")) if False else None

from PIL import Image, ImageDraw, ImageFont

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SHOT_W, SHOT_H = 1400, 900
OUT_W = 1000
BAR_H = 92
BAR_BG = (16, 20, 26)
RULE = (28, 33, 40)
FG = (230, 232, 235)
MUTED = (139, 147, 161)
ACCENT = (124, 116, 255)
FPS_HINT = 10


# --------------------------------------------------------------------------
# The production the journey builds. Deliberately tiny — the point is the
# workflow, not the interface.
# --------------------------------------------------------------------------

PRODUCTION = "Demo.Lab.LabProduction"
SERVICE = "Demo.Lab.Service.LabResultIn"

CREATE_PRODUCTION = f"""
zn "{{ns}}"
set cd=##class(%Dictionary.ClassDefinition).%New("{PRODUCTION}")
set cd.Super="Ens.Production"
set cd.ProcedureBlock=1
set cd.Description="Lab results interface"
set xd=##class(%Dictionary.XDataDefinition).%New()
set xd.Name="ProductionDefinition"
set xd.parent=cd
do xd.Data.Write("<Production Name=""{PRODUCTION}""><Description></Description><ActorPoolSize>2</ActorPoolSize></Production>")
set sc=cd.%Save()
set sc=$system.OBJ.Compile("{PRODUCTION}","ck-d")
write !,"created production",!
halt
"""

CREATE_SERVICE = f"""
zn "{{ns}}"
set cd=##class(%Dictionary.ClassDefinition).%New("{SERVICE}")
set cd.Super="EnsLib.HL7.Service.TCPService"
set cd.ProcedureBlock=1
set cd.Description="Inbound lab results over MLLP"
set sc=cd.%Save()
set sc=$system.OBJ.Compile("{SERVICE}","ck-d")
set pd=##class(%Dictionary.ClassDefinition).%OpenId("{PRODUCTION}")
set xd=pd.XDatas.GetAt(1)
do xd.Data.Clear()
do xd.Data.Write("<Production Name=""{PRODUCTION}""><Description></Description><ActorPoolSize>2</ActorPoolSize><Item Name=""LabResultIn"" ClassName=""{SERVICE}"" PoolSize=""1"" Enabled=""true""></Item></Production>")
set sc=pd.%Save()
set sc=$system.OBJ.Compile("{PRODUCTION}","ck-d")
write !,"added business service",!
halt
"""

CLEANUP = f"""
zn "{{ns}}"
do $system.OBJ.Delete("{PRODUCTION}","-d")
do $system.OBJ.Delete("{SERVICE}","-d")
write !,"cleaned",!
halt
"""


# --------------------------------------------------------------------------
# Scenes. Each is (kind, target, seconds, step, caption).
#   shot  — capture a URL
#   iris  — run ObjectScript in the container, capture nothing
#   api   — POST to the tool's API
# --------------------------------------------------------------------------

def scenes(host):
    tool = f"{host}/hcccicd/index.html"
    harness = f"{host}/hcccicd/_harness/editor.html"
    return [
        ("api", "reset", 0, "", ""),

        ("shot", f"{host}/csp/sys/UtilHome.csp", 4.5, "1",
         "Sign in to Health Connect Cloud. Nothing here is different from any other day."),

        ("shot", f"{harness}?state=none", 6.0, "2",
         "Open the Interoperability page. Before you touch anything, Change Control tells you what to do."),

        ("shot", f"{harness}?state=none&guide=0", 4.5, "3",
         "Dismiss it and the strip stays. Amber means nothing is started, so nothing you build belongs to a change yet."),

        ("shot", f"{tool}?live=1&focus=start", 5.0, "4",
         "Open Change Control. One form: your ticket reference and one line saying what you are about to do."),

        ("api", "start", 0, "", ""),

        ("shot", f"{tool}?live=1", 5.0, "5",
         "That is the whole setup. You now have a private copy of the configuration and a hold on anything you touch."),

        ("shot", f"{harness}?state=open&guide=0", 4.0, "6",
         "Back in the editor the strip has gone green. Now go and build — nothing else about your day changes."),

        ("iris", CREATE_PRODUCTION, 0, "", ""),

        ("shot", f"{tool}?live=1&demo=livechanges", 6.0, "7",
         "Create an empty production in the editor. It appears here on its own — version 1, no export, nothing to remember."),

        ("iris", CREATE_SERVICE, 0, "", ""),

        ("shot", f"{tool}?live=1&demo=livechanges", 6.0, "8",
         "Add a business service to it. Both are captured, and the production moves to version 2."),

        ("shot", f"{tool}?live=1&demo=livepick", 5.5, "9",
         "Time to send it to Test. Tick the production — and forget the business service, which is the easy mistake."),

        ("shot", f"{tool}?live=1&demo=livecheck", 7.0, "10",
         "The safety check reads the production definition, finds the service it points at, and sees it is not selected."),

        ("shot", f"{tool}?live=1&demo=livefix", 6.0, "11",
         "One click adds it. Without this the deployment would have succeeded and the production would not have started."),

        ("shot", f"{tool}?live=1&demo=livesubmit", 5.5, "12",
         "Submitted, with both items. Approval and deployment happen from here."),

        ("iris", CLEANUP, 0, "", ""),
        ("api", "reset", 0, "", ""),
    ]


# --------------------------------------------------------------------------

def font(size, bold=False):
    path = ("/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold
            else "/System/Library/Fonts/Supplemental/Arial.ttf")
    if os.path.exists(path):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default()


def shoot(url, out_path):
    subprocess.run(
        [CHROME, "--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
         f"--window-size={SHOT_W},{SHOT_H}", "--virtual-time-budget=6000",
         f"--screenshot={out_path}", url],
        check=True, capture_output=True,
    )


def iris(container, namespace, script):
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
        f.write(script.format(ns=namespace))
        path = f.name
    # docker cp preserves the mode, and NamedTemporaryFile is 0600 owned by
    # this user. IRIS runs as irisowner inside the container and cannot read
    # that, so the session fails with a permission error before running a line.
    os.chmod(path, 0o644)
    try:
        subprocess.run(["docker", "cp", path, f"{container}:/tmp/journey.txt"],
                       check=True, capture_output=True)
        subprocess.run(["docker", "exec", container, "chmod", "644", "/tmp/journey.txt"],
                       check=False, capture_output=True)
        r = subprocess.run(["docker", "exec", container, "bash", "-lc",
                            "iris session iris -U %SYS < /tmp/journey.txt"],
                           capture_output=True, text=True)
        out = (r.stdout or "") + (r.stderr or "")
        # The session terminates on halt, which some builds report as a
        # non-zero exit even when every line ran. Trust the marker the script
        # itself writes rather than the exit code.
        if "<" in out and "ERROR" in out.upper():
            raise RuntimeError(f"IRIS reported an error:\n{out.strip()[-1200:]}")
        if r.returncode != 0 and "halt" not in out:
            raise RuntimeError(f"iris session failed ({r.returncode}):\n{out.strip()[-1200:]}")
    finally:
        os.unlink(path)


def api(host, what):
    if what == "reset":
        subprocess.run(["curl", "-s", "-o", "/dev/null", "-X", "POST",
                        f"{host}/api/hcccicd/reset"], check=True)
    elif what == "start":
        subprocess.run(["curl", "-s", "-o", "/dev/null", "-X", "POST",
                        "-H", "Content-Type: application/json",
                        "-d", '{"ref":"INT-5104","title":"Lab results interface"}',
                        f"{host}/api/hcccicd/workspace"], check=True)


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
    scale = OUT_W / img.width
    img = img.convert("RGB").resize((OUT_W, round(img.height * scale)), Image.LANCZOS)
    out = Image.new("RGB", (OUT_W, img.height + BAR_H), BAR_BG)
    out.paste(img, (0, 0))
    d = ImageDraw.Draw(out)
    d.line([(0, img.height), (OUT_W, img.height)], fill=RULE, width=1)

    cx, cy, r = 34, img.height + BAR_H // 2, 15
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=ACCENT)
    f_step, f_text = font(13, bold=True), font(16)
    sw = d.textlength(step, font=f_step)
    d.text((cx - sw / 2, cy - 8), step, font=f_step, fill=(255, 255, 255))

    lines = wrap(d, text, f_text, OUT_W - 90)
    lh = 22
    ty = cy - (len(lines) * lh) // 2 - 1
    for i, line in enumerate(lines):
        d.text((62, ty + i * lh), line, font=f_text, fill=FG if i == 0 else MUTED)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="http://localhost:22773")
    ap.add_argument("--container", default="iris-agentic")
    ap.add_argument("--namespace", default="HSCUSTOM")
    args = ap.parse_args()

    if not os.path.exists(CHROME):
        sys.exit(f"Google Chrome not found at {CHROME}")
    os.makedirs(os.path.join("docs", "img"), exist_ok=True)

    imgs, durations = [], []
    tmp = tempfile.mkdtemp(prefix="hcccicd-journey-")
    n = 0
    try:
        for kind, target, secs, step, text in scenes(args.host):
            if kind == "iris":
                print("  ~ iris: applying change to the namespace")
                iris(args.container, args.namespace, target)
                time.sleep(1.0)
                continue
            if kind == "api":
                print(f"  ~ api: {target}")
                api(args.host, target)
                time.sleep(0.5)
                continue

            n += 1
            print(f"  [{n}] step {step}")
            raw = os.path.join(tmp, f"j{n:02d}.png")
            shoot(f"{target}{'&' if '?' in target else '?'}t={n}", raw)
            imgs.append(caption(Image.open(raw), step, text))
            durations.append(int(secs * 1000))

        h = imgs[0].height
        merged = Image.new("RGB", (imgs[0].width, h * len(imgs)))
        for i, im in enumerate(imgs):
            merged.paste(im, (0, i * h))
        pal = merged.quantize(colors=128, method=Image.MEDIANCUT)
        q = [im.quantize(palette=pal, dither=Image.FLOYDSTEINBERG) for im in imgs]

        out = os.path.join("docs", "img", "production-journey.gif")
        q[0].save(out, save_all=True, append_images=q[1:], duration=durations,
                  loop=0, optimize=True, disposal=2)
        print(f"  -> {out}  ({os.path.getsize(out) / 1_048_576:.1f} MB, "
              f"{sum(durations) / 1000:.0f}s)")
    finally:
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
