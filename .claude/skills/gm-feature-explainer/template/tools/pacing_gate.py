#!/usr/bin/env python3
"""The pacing gate: no settled frames, no dead air.

Measures a rendered film (and, if given, its voiceover) and fails on:
  - HOLD   any freezedetect hold (n=0.002, d=0.6, on 480 px frames) longer than 0.6 s, except ONE declared stillness
           beat (<= 1.0 s) listed in timing.json "stillness" (or --allow a-b). The hold must overlap that window.
  - VO GAP any silence between two sentences longer than the authored maximum (0.6 s between acts; default
           --max-gap 0.65 s to allow for the silence detector's own slack) -- needs --vo.
Reports (always): length, % of the film held (d=0.4, the diagnostic used to compare films, and d=0.6, the gate),
the longest hold, VO silence %, the longest internal VO gap, and integrated loudness / true peak of the MP4.

usage: python tools/pacing_gate.py <render.mp4> [--vo assets/audio/voiceover.wav] [--timing timing.json]
                                   [--allow 7.9-8.6] [--json out.json] [--no-gate]
Exit 1 if a gate fails (unless --no-gate). Pure ffmpeg + python, no numpy needed.
"""
import argparse, json, re, subprocess, sys

ap = argparse.ArgumentParser()
ap.add_argument("mp4")
ap.add_argument("--vo")
ap.add_argument("--timing")
ap.add_argument("--allow", help="declared stillness window a-b (s); overrides timing.json")
ap.add_argument("--max-hold", type=float, default=0.6)
ap.add_argument("--max-still", type=float, default=1.0)
ap.add_argument("--max-gap", type=float, default=0.65)
ap.add_argument("--json")
ap.add_argument("--no-gate", action="store_true")
a = ap.parse_args()


def ff(args):
    return subprocess.run(["ffmpeg", "-hide_banner", "-nostats"] + args, capture_output=True, text=True).stderr


def duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                         capture_output=True, text=True).stdout
    return float(out.strip())


def freezes(path, d, total):
    err = ff(["-i", path, "-vf", "scale=480:-2,freezedetect=n=0.002:d=%s" % d, "-an", "-f", "null", "-"])
    st = [float(x) for x in re.findall(r"freeze_start: ([\d.]+)", err)]
    en = [float(x) for x in re.findall(r"freeze_end: ([\d.]+)", err)]
    if len(en) < len(st):
        en.append(total)  # a hold that runs to the last frame (freezedetect never closes it; it still counts)
    return [(round(s, 3), round(e, 3)) for s, e in zip(st, en)]


def silences(path, total):
    err = ff(["-i", path, "-af", "silencedetect=noise=-40dB:d=0.2", "-f", "null", "-"])
    st = [float(x) for x in re.findall(r"silence_start: (-?[\d.]+)", err)]
    en = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", err)]
    if len(en) < len(st):
        en.append(total)
    return [(max(0.0, s), e) for s, e in zip(st, en)]


T = duration(a.mp4)
rep = {"file": a.mp4, "length": round(T, 3)}
f4, f6 = freezes(a.mp4, 0.4, T), freezes(a.mp4, 0.6, T)
held = lambda F: round(100 * sum(e - s for s, e in F) / T, 1)
rep["held_pct_d04"] = held(f4)
rep["held_pct_d06"] = held(f6)
rep["longest_hold"] = round(max([e - s for s, e in f4] or [0]), 3)
# the same numbers without a hold that runs into the last frame (freezedetect leaves it open; earlier
# reports measured that way, so it is kept for comparison). The gate always counts the tail.
f4c = [(s, e) for s, e in f4 if e < T - 0.05]
rep["held_pct_d04_excl_tail"] = held(f4c)
rep["longest_hold_excl_tail"] = round(max([e - s for s, e in f4c] or [0]), 3)
rep["holds_d06"] = f6
rep["holds_d04"] = f4

allow = None
if a.allow:
    allow = [float(x) for x in a.allow.split("-")]
elif a.timing:
    st = json.load(open(a.timing)).get("stillness")
    if st:
        allow = [float(st[0]), float(st[1])]
rep["declared_stillness"] = allow
fails = []
if allow and allow[1] - allow[0] > a.max_still + 1e-6:
    fails.append("declared stillness %.2f-%.2f is longer than %.1f s" % (allow[0], allow[1], a.max_still))
used = False
for s, e in f6:
    dur = e - s
    if dur <= a.max_hold + 1e-6:
        continue
    if allow and not used and s < allow[1] + 0.1 and e > allow[0] - 0.1 and dur <= a.max_still + 1e-6:
        used = True
        continue
    fails.append("HOLD %.2f-%.2f (%.2f s > %.1f s)" % (s, e, dur, a.max_hold))

if a.vo:
    VT = duration(a.vo)
    sil = silences(a.vo, VT)
    rep["vo_silence_pct"] = round(100 * sum(e - s for s, e in sil) / VT, 1)
    internal = [(s, e) for s, e in sil if s > 0.05 and e < VT - 0.05]
    rep["vo_longest_gap"] = round(max([e - s for s, e in internal] or [0]), 3)
    rep["vo_gaps"] = [(round(s, 2), round(e, 2)) for s, e in internal]
    for s, e in internal:
        if e - s > a.max_gap:
            fails.append("VO GAP %.2f-%.2f (%.2f s > %.2f s)" % (s, e, e - s, a.max_gap))

err = ff(["-i", a.mp4, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"])
try:
    rep["lufs"] = float(re.findall(r"I:\s+(-?[\d.]+) LUFS", err)[-1])
    rep["true_peak"] = float(re.findall(r"Peak:\s+(-?[\d.]+) dBFS", err)[-1])
except IndexError:
    rep["lufs"] = rep["true_peak"] = None

rep["fails"] = fails
rep["pass"] = not fails
if a.json:
    json.dump(rep, open(a.json, "w"), indent=1)
print(json.dumps({k: v for k, v in rep.items() if k not in ("holds_d06", "holds_d04", "vo_gaps")}, indent=1))
for s, e in f6:
    print("  hold %.2f-%.2f (%.2f s)" % (s, e, e - s))
for f in fails:
    print("FAIL:", f)
print("PACING GATE:", "PASS" if not fails else "FAIL")
sys.exit(0 if (not fails or a.no_gate) else 1)
