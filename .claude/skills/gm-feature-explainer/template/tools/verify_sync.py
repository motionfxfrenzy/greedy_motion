#!/usr/bin/env python3
"""The invariant gate: every demonstrated action lands within ±0.25 s of its verb's word onset.

Inputs:  timing.json (verb onsets from the transcript + boundary probe), verify/actions.json (what the engine scheduled,
         from tools/actions.mjs), and the rendered MP4.
Measures: in the RENDER, around each action's target point, the first frame where the pixels change after the cursor has
          come to rest (press + target reaction). That frame is the action as the viewer sees it.
Writes:  verify/sync.md (table) and verify/sync.json. Exit 1 if any |measured - verb| > 0.25 s.
usage: python tools/verify_sync.py <project> <render.mp4>
"""
import json, subprocess, sys, pathlib
import numpy as np

proj = pathlib.Path(sys.argv[1]).resolve()
mp4 = sys.argv[2]
T = json.load(open(proj / "timing.json"))
A = json.load(open(proj / "verify/actions.json"))["actions"]
FPS, R = 30, 110  # crop half-size around the cursor tip / target
rows, out, worst = [], [], 0.0


def frames(t0, t1, x, y):
    x0, y0 = max(0, x - R), max(0, y - R)
    w, h = min(2 * R, 1920 - x0), min(2 * R, 1080 - y0)
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", "%.3f" % t0, "-i", mp4, "-t", "%.3f" % (t1 - t0),
                          "-vf", "crop=%d:%d:%d:%d,format=gray" % (w, h, x0, y0), "-r", str(FPS), "-f", "rawvideo", "-"],
                         capture_output=True, check=True).stdout
    n = len(raw) // (w * h)
    return np.frombuffer(raw[: n * w * h], np.uint8).reshape(n, h, w).astype(np.float32)


verbs = {str(i + 1): b for i, b in enumerate(T["beats"])}
verbs["cta"] = T["cta"]
for a in A:
    key = str(a["beat"])
    tv = verbs[key]["verb_t"]
    t0 = round((tv - 0.6) * FPS) / FPS
    F = frames(t0, tv + 0.6, a["x"], a["y"])
    d = np.abs(np.diff(F, axis=0)).mean(axis=(1, 2))  # d[k] = change from frame k to k+1
    ts = t0 + (np.arange(len(d)) + 1) / FPS            # time of frame k+1
    # the cursor lands LEAD (0.16 s) before the verb and rests; the action is the first frame after that rest that jumps
    pre = (ts > tv - 0.15) & (ts <= tv - 0.0)
    base = float(np.median(d[pre])) if pre.any() else 0.0
    thr = max(1.0, base * 3 + 0.5)
    cand = np.where((ts >= tv - 0.12) & (d > thr))[0]
    meas = float(ts[cand[0]]) if len(cand) else None
    delta = (meas - tv) if meas is not None else float("nan")
    worst = max(worst, abs(delta)) if meas is not None else 99
    ev = verbs[key].get("evidence", {})
    rows.append("| %s | %s | %s | %s | %.3f | %s | %.3f | %s | %s |" % (
        key, a.get("chip") or "CTA", a["verb"], a["action"], tv, ev.get("how", "-"), a["t"],
        ("%.3f" % meas) if meas is not None else "n/a", ("%+.3f" % delta) if meas is not None else "n/a"))
    out.append({"beat": key, "verb": a["verb"], "verb_t": tv, "planned": a["t"], "measured": meas, "delta": delta,
                "target": [a["x"], a["y"]], "baseline_diff": base, "threshold": thr})

hdr = ["| beat | chip | verb | action | verb onset (s) | onset method | engine action (s) | action seen in render (s) | Δ render − verb |",
       "|---|---|---|---|---|---|---|---|---|"]
txt = "\n".join(hdr + rows) + "\n\nWorst |Δ| = %.3f s (gate ±0.250 s): %s\n" % (worst, "PASS" if worst <= 0.25 else "FAIL")
open(proj / "verify/sync.md", "w").write(txt)
json.dump(out, open(proj / "verify/sync.json", "w"), indent=1)
print(txt)
sys.exit(0 if worst <= 0.25 else 1)
