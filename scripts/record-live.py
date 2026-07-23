#!/usr/bin/env python3
"""Record the end-to-end walkthrough against a real IRIS namespace.

Unlike record-walkthrough.py, which drives the seeded fixture, this one builds
a real production in the target namespace and follows it all the way to
Production, shooting the tool between each real state change. What you see in
the frames is IRIS reporting on itself.

The scenario is deliberately generic — one empty production, no lab or FHIR
specifics — so the recording shows the mechanism rather than a use case.

    ./scripts/record-live.py [--container iris-agentic] [--namespace HSCUSTOM]

Writes docs/img/live-walkthrough.gif.

The API requires a signed-in user, and headless Chrome has no way to obtain a
session, so this temporarily widens /api/hcccicd to allow unauthenticated
callers and puts it back afterwards — including if a step fails.
"""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import base64
import json

from PIL import Image, ImageDraw, ImageFont

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SHOT_W, SHOT_H = 1400, 950
OUT_W = 1000
BAR_H = 78
BAR_BG = (16, 20, 26)
RULE = (28, 33, 40)
FG = (230, 232, 235)
MUTED = (139, 147, 161)
ACCENT = (124, 116, 255)

PROD = "Demo.Generic.Production"


def font(size, bold=False):
    path = ("/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold
            else "/System/Library/Fonts/Supplemental/Arial.ttf")
    if os.path.exists(path):
        return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def shoot(url, out_path):
    subprocess.run(
        [CHROME, "--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
         f"--window-size={SHOT_W},{SHOT_H}", "--virtual-time-budget=6000",
         f"--screenshot={out_path}", url],
        check=True, capture_output=True)


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
    cy = img.height + BAR_H // 2
    r = 13
    d.ellipse([30 - r, cy - r, 30 + r, cy + r], fill=ACCENT)
    f_step, f_text = font(13, True), font(15)
    sw = d.textlength(step, font=f_step)
    d.text((30 - sw / 2, cy - 8), step, font=f_step, fill=(255, 255, 255))
    lines = wrap(d, text, f_text, OUT_W - 80)
    ty = cy - (len(lines) * 21) // 2 - 1
    for i, line in enumerate(lines):
        d.text((54, ty + i * 21), line, font=f_text, fill=FG if i == 0 else MUTED)
    return out


class Iris:
    def __init__(self, container, namespace, host, user, pwd):
        self.container, self.ns, self.host = container, namespace, host
        self.auth = base64.b64encode(f"{user}:{pwd}".encode()).decode()

    def script(self, body):
        """Run ObjectScript. Terminal mode evaluates line by line, so every
        statement has to stand alone — no multi-line blocks."""
        with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
            f.write(f'zn "{self.ns}"\n{body}\nhalt\n')
            path = f.name
        # tempfile creates 0600 and docker cp preserves the mode, so the IRIS
        # user cannot read it. Widen before copying.
        os.chmod(path, 0o644)
        subprocess.run(["docker", "cp", path, f"{self.container}:/tmp/rec.txt"],
                       check=True, capture_output=True)
        out = subprocess.run(
            ["docker", "exec", self.container, "bash", "-lc",
             "iris session iris -U %s < /tmp/rec.txt" % self.ns],
            capture_output=True, text=True)
        os.unlink(path)
        # IRIS in terminal mode writes to both streams; a check that reads only
        # stdout sees nothing and concludes the command failed.
        return (out.stdout or "") + (out.stderr or "")

    def api(self, method, path, payload=None):
        req = urllib.request.Request(
            f"{self.host}/api/hcccicd{path}", method=method,
            data=json.dumps(payload).encode() if payload else None)
        # Deliberately anonymous while recording. State is per user, and the
        # browser reaches the widened API as UnknownUser — driving the API as
        # _SYSTEM would build the change in a different user's world and the
        # frames would show an empty tool.
        req.add_header("X-IRIS-Namespace", self.ns)
        if payload:
            req.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read().decode())

    def webapp(self, prop, value):
        self.script(
            'zn "%%SYS"\n'
            'kill p do ##class(Security.Applications).Get("/api/hcccicd",.p)\n'
            'set p("%s")=%s\n'
            'set sc=##class(Security.Applications).Modify("/api/hcccicd",.p)\n'
            'write !,"webapp %s=",%s," sc=",+sc,!' % (prop, value, prop, value))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--container", default="iris-agentic")
    ap.add_argument("--namespace", default="HSCUSTOM")
    ap.add_argument("--host", default="http://localhost:22773")
    ap.add_argument("--user", default="_SYSTEM")
    ap.add_argument("--password", default="Agentic1!")
    args = ap.parse_args()

    if not os.path.exists(CHROME):
        sys.exit("Google Chrome not found")
    os.makedirs("docs/img", exist_ok=True)

    iris = Iris(args.container, args.namespace, args.host, args.user, args.password)
    tmp = tempfile.mkdtemp(prefix="hcccicd-live-")
    frames = []
    L = f"{args.host}/hcccicd/index.html?live=1"

    def snap(step, text, url_extra, secs=4.0):
        i = len(frames)
        raw = os.path.join(tmp, f"f{i:02d}.png")
        print(f"  [{i + 1}] {text[:58]}")
        shoot(f"{L}&{url_extra}&t={i}", raw)
        frames.append((caption(Image.open(raw), step, text), int(secs * 1000)))

    try:
        # Open up so headless Chrome can reach the API at all, and prove it
        # took effect — a silent failure here produces a whole recording of
        # the "sign in" dialog, which is exactly what happened the first time.
        iris.webapp("AutheEnabled", 96)
        probe = urllib.request.Request(f"{args.host}/api/hcccicd/whoami")
        try:
            with urllib.request.urlopen(probe) as r:
                who = json.loads(r.read().decode())
            print(f"  anonymous access confirmed as {who['username']}")
        except Exception as e:
            sys.exit(f"Could not open the API for recording ({e}). "
                     "Nothing was changed permanently; re-run once resolved.")

        print("Preparing a clean namespace")
        iris.script(f'kill ^HCCCICD\ndo $system.OBJ.Delete("{PROD}","-d")')
        left = iris.script('write !,"seq=",$get(^HCCCICD("seq"),0),!')
        if "seq=0" not in left:
            sys.exit("The namespace did not reset; refusing to record a misleading run.\n" + left)
        iris.api("GET", "/state")                       # seed the baseline
        iris.api("PUT", "/config", {"approvalRequired": 0})

        snap("1", "Nothing started. The tool is empty because the namespace has not changed since the baseline.",
             "screen=workspace", 4.0)

        print("Starting a change")
        ws = iris.api("POST", "/workspace", {"title": "Add a new production"})
        ref = ws["workspace"]["ref"]
        snap("2", f"Start a change. The system numbers it {ref} — the namespace and the next number.",
             "screen=workspace", 4.5)

        print("Creating a real production in IRIS")
        iris.script(
            f'set cd=##class(%Dictionary.ClassDefinition).%New("{PROD}")\n'
            'set cd.Super="Ens.Production"\n'
            'set cd.ProcedureBlock=1\n'
            'set cd.Description="A generic production, created to demonstrate change capture"\n'
            'set xd=##class(%Dictionary.XDataDefinition).%New()\n'
            'set xd.Name="ProductionDefinition"\n'
            'set xd.parent=cd\n'
            f'do xd.Data.Write("<Production Name=""{PROD}""><ActorPoolSize>2</ActorPoolSize></Production>")\n'
            'do cd.%Save()\n'
            f'do $system.OBJ.Compile("{PROD}","ck-d")')

        snap("3", "Build a production in the editor exactly as you always would. Nothing else to do.",
             "screen=changes", 4.5)
        snap("4", "It is already captured and versioned. No export, no add-to-source-control step.",
             "screen=changes", 4.5)
        snap("5", "Describe what changed and why. This is what the approver reads.",
             "screen=promote&step=1&title=Add%20a%20new%20production"
             "&what=A%20new%2C%20empty%20production%20ready%20for%20business%20hosts."
             "&why=Standing%20up%20the%20interface%20for%20the%20new%20feed.", 4.5)
        snap("6", "Tick what goes forward.",
             "screen=promote&step=2&pick=all", 4.0)
        snap("7", "The safety check follows every reference out of what you picked, before it leaves.",
             "screen=promote&step=3&pick=all", 5.0)

        print("Submitting")
        st = iris.api("GET", "/state")
        keys = [c["key"] for c in st["changes"]]
        iris.api("POST", "/requests", {
            "title": "Add a new production", "target": "test", "items": keys,
            "what": "A new, empty production ready for business hosts.",
            "why": "Standing up the interface for the new feed."})
        snap("8", "Submitted. Approval is bypassed here, so it is approved and deployed to Test at once.",
             "screen=requests", 5.0)

        print("Promoting to Production")
        iris.api("POST", f"/requests/{ref}/promote")
        snap("9", "Send the same items on to Production. They are not picked again.",
             "screen=requests", 5.0)
        snap("10", "The route and the approval rules, both configurable — this is where the next target is set.",
             "screen=environments", 5.0)

        print("Assembling")
        h = frames[0][0].height
        merged = Image.new("RGB", (OUT_W, h * len(frames)))
        for i, (im, _) in enumerate(frames):
            merged.paste(im, (0, i * h))
        pal = merged.quantize(colors=128, method=Image.MEDIANCUT)
        qs = [im.quantize(palette=pal, dither=Image.FLOYDSTEINBERG) for im, _ in frames]
        out = "docs/img/live-walkthrough.gif"
        qs[0].save(out, save_all=True, append_images=qs[1:],
                   duration=[d for _, d in frames], loop=0, optimize=True, disposal=2)
        print(f"  -> {out}  ({os.path.getsize(out) / 1_048_576:.1f} MB)")

    finally:
        # Always put the door back, and clear the demo artifact and state.
        print("Restoring")
        iris.webapp("AutheEnabled", 32)
        iris.script(f'do $system.OBJ.Delete("{PROD}","-d")\nkill ^HCCCICD')
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
