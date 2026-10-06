#!/usr/bin/env python3
"""gm-feature-explainer pipeline: content.json -> voiceover -> transcript clock -> mix -> variables.json (+ index.html).

Run with a Python that has numpy + soundfile (the hyperframes TTS venv does):
  PY=~/.cache/hyperframes/tts/venv/bin/python
  $PY tools/pipeline.py vo       # Kokoro TTS per line (local, $0), tight authored gaps -> assets/audio/voiceover.wav
  $PY tools/pipeline.py beats    # hyperframes beats on the bed -> assets/audio/beats.json (cut snapping)
  $PY tools/pipeline.py timing   # hyperframes transcribe + verb probe + J-cuts -> timing.json + verify/sync-plan.md
  $PY tools/pipeline.py mix      # VO + bed (sidechain-ducked) + SFX at the clock's times -> assets/audio/mix.wav
  $PY tools/pipeline.py vars     # content.json + timing.json -> variables.json
  $PY tools/pipeline.py index    # variables.json -> index.html defaults (author mode only; fill mode never edits HTML)
  $PY tools/pipeline.py all

Every scene boundary is derived from the transcript. No line is sped up, trimmed or stretched; gaps are the only edit.
Pacing (v1.1): gaps are 0.25-0.4 s inside an act and <= 0.6 s between acts; every scene's exit starts on the last
stressed word of its outgoing line (a J-cut under speech), snapped to a beat of the bed when one is within 0.15 s.
"""
import hashlib, json, os, re, subprocess, sys, pathlib
import numpy as np, soundfile as sf

ROOT = pathlib.Path(os.environ.get("PROJECT", pathlib.Path(__file__).resolve().parents[1]))
REPO = pathlib.Path("/Users/osamaehsaan/Code/Market_apps/VideoSaaS")
HF = str(REPO / "worker/node_modules/.bin/hyperframes")
TTS_PY = str(pathlib.Path.home() / ".cache/hyperframes/tts/venv/bin/python")
SR = 48000
FPS = 30
TYPE_CPS = 24  # must match engine.js
EXIT = 0.32    # must match engine.js: a scene's exit tween (the J-cut window) is this long and ends on the cut
LEAD = 0.5
# pacing defaults; override per film with content.json "pacing": {...} or env GAP_IN_ACT / GAP_BETWEEN_ACTS / TAIL
PACING = {"gap_in_act": 0.3, "gap_between_acts": 0.45, "tail": 1.2, "voice_speed": 1.1,
          "jcut_lead": 0.04,      # the exit starts this long before the last stressed word's onset
          "beat_snap": 0.15,      # snap the cut to a bed beat within this window, else the VO wins
          "result_hold": 0.35,    # a beat's result stays on screen at least this long before its exit starts
          "late_cut_max": 0.25}   # a cut may land at most this long after the next line starts
MUSIC = os.environ.get("MUSIC", str(REPO / "experiments/gm-ad-test/google/audio/music_v2.mp3"))
MUSIC_OFFSET = float(os.environ.get("MUSIC_OFFSET", "0"))
SFX = ROOT / "assets/sfx"
# function words never carry the sentence stress; the J-cut lands on the last word NOT in this set
STOP = set("""a an the and or but so then than to of in on at by for with from into onto over under as is are was were be
been it its it's this that these those you your you're we our us they their them he she his her i me my what which who
whom while when where how all any each every one just very really can will would should could do does did done have has
had not no yes up out off about again more most some such only own same too here there now today""".split())


def pacing(c=None):
    c = c if c is not None else content()
    p = dict(PACING); p.update(c.get("pacing", {}))
    for k, env in (("gap_in_act", "GAP_IN_ACT"), ("gap_between_acts", "GAP_BETWEEN_ACTS"), ("tail", "TAIL")):
        if os.environ.get(env): p[k] = float(os.environ[env])
    if "voice_speed" in c: p["voice_speed"] = c["voice_speed"]
    return p


def content():
    return json.load(open(ROOT / "content.json"))


def lines(c):
    out = [("problem%d" % (k + 1), "problem", t) for k, t in enumerate(c["problem_lines"])]
    out.append(("reveal", "reveal", c["reveal_line"]))
    out += [("beat%d" % (k + 1), "beat", b["line"]) for k, b in enumerate(c["beats"])]
    out.append(("cta", "cta", c["cta_line"]))
    return out


def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode:
        sys.exit("FAILED: %s\n%s\n%s" % (" ".join(cmd), r.stdout[-2000:], r.stderr[-2000:]))
    return r.stdout


def load48(path):
    """decode anything to mono float32 @48k via ffmpeg"""
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


# ---------------------------------------------------------------- voiceover
def gap_for(prev_kind, kind, pc):
    """0.25-0.4 s between sentences inside an act (problem lines; tour beats), <= 0.6 s between acts."""
    return pc["gap_in_act"] if prev_kind == kind and kind in ("problem", "beat") else pc["gap_between_acts"]


def cmd_vo():
    c = content(); pc = pacing(c)
    for k, lo, hi in (("gap_in_act", 0.25, 0.4), ("gap_between_acts", 0.0, 0.6)):
        if not lo <= pc[k] <= hi:
            print("PROBLEM: pacing %s = %.2f s is outside %.2f-%.2f s (dead air between lines)" % (k, pc[k], lo, hi))
    vdir = ROOT / "assets/audio/vo"; vdir.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, HYPERFRAMES_PYTHON=TTS_PY)
    voice, speed = c.get("voice", "af_heart"), str(pc["voice_speed"])
    parts, t, asm, gaps = [np.zeros(int(LEAD * SR), np.float32)], LEAD, [], {}
    prev = None
    for i, (lid, kind, text) in enumerate(lines(c)):
        h = hashlib.sha1(("%s|%s|%s" % (voice, speed, text)).encode()).hexdigest()[:10]
        wav = vdir / ("%s-%s.wav" % (lid, h))
        if not wav.exists():
            run([HF, "tts", text, "-v", voice, "-s", speed, "-o", str(wav)], env=env)
        a = load48(wav)
        # trim Kokoro's own leading/trailing silence so the authored gap is the real gap
        nz = np.where(np.abs(a) > 0.004)[0]
        a = a[max(0, nz[0] - int(0.03 * SR)): nz[-1] + int(0.06 * SR)] if len(nz) else a
        if i:
            g = gap_for(prev, kind, pc); gaps[lid] = g
            parts.append(np.zeros(int(g * SR), np.float32)); t += g
        asm.append({"id": lid, "kind": kind, "text": text, "start": round(t, 3), "dur": round(len(a) / SR, 3), "file": wav.name})
        parts.append(a.astype(np.float32)); t += len(a) / SR
        prev = kind
    parts.append(np.zeros(int(pc["tail"] * SR), np.float32))
    y = np.concatenate(parts)
    pk = np.max(np.abs(y)); y = y * (0.5 / pk)  # gain only; loudness is set in the mix
    sf.write(ROOT / "assets/audio/voiceover.wav", y, SR, subtype="PCM_16")
    json.dump({"voice": voice, "speed": speed, "lead": LEAD, "tail": pc["tail"], "gaps": gaps, "pacing": pc, "lines": asm,
               "total": round(len(y) / SR, 3)}, open(vdir / "assembly.json", "w"), indent=1)
    print("voiceover %.2fs, %d lines, gaps %s" % (len(y) / SR, len(asm), sorted(set(gaps.values()))))


# ---------------------------------------------------------------- bed beats (cut snapping)
def cmd_beats():
    """hyperframes beats needs a project whose <audio> is the music: build a throwaway one in verify/beats."""
    d = ROOT / "verify/beats"; d.mkdir(parents=True, exist_ok=True)
    ext = pathlib.Path(MUSIC).suffix
    link = d / ("bed" + ext)
    if link.exists() or link.is_symlink(): link.unlink()
    link.symlink_to(MUSIC)
    (d / "index.html").write_text('<!doctype html><html><body><div id="root" data-composition-id="main" data-start="0" '
                                  'data-width="1920" data-height="1080" data-duration="120"><audio id="music" '
                                  'data-timeline-role="music" src="bed%s" data-start="0" data-track-index="1"></audio></div>'
                                  '</body></html>' % ext)
    out = json.loads(run([HF, "beats", str(d), "--json"]))
    B = json.load(open(d / out["file"]))
    beats = [{"t": round(b["time"] - MUSIC_OFFSET, 3), "strength": b.get("strength", 1)} for b in B["beats"] if b["time"] >= MUSIC_OFFSET]
    json.dump({"source": MUSIC, "offset": MUSIC_OFFSET, "bpm_detected": out.get("bpm"), "beats": beats},
              open(ROOT / "assets/audio/beats.json", "w"), indent=1)
    print("beats.json: %d beats (detector bpm %s)" % (len(beats), out.get("bpm")))


# ---------------------------------------------------------------- transcript clock
def norm(w):
    return re.sub(r"[^a-z0-9']", "", w.lower())


def transcribe(wav, d):
    d.mkdir(parents=True, exist_ok=True)
    run([HF, "transcribe", str(wav), "-d", str(d), "--json"])
    return json.load(open(d / "transcript.json"))


def matches(x, target):
    """x (a normalised heard word) is the target word. Targets may list aliases with '|'. Invented names are matched
    fuzzily (whisper hears 'Tidyslot' as 'Tittyslot', 'Tidislot', 'Tiddaslot')."""
    import difflib
    if not x: return False
    for alt in target.split("|"):
        tn = norm(alt)
        if x == tn or (x.startswith(tn) and len(x) - len(tn) <= 2) or (tn.startswith(x) and len(x) >= len(tn) - 2):
            return True
        if "|" in target and len(tn) >= 5 and difflib.SequenceMatcher(None, x, tn).ratio() >= 0.7:
            return True
    return False


def find_word(words, target, t0, t1):
    cands = [w for w in words if t0 - 0.2 <= w["start"] <= t1 + 0.2]
    for w in cands:
        if matches(norm(w["text"]), target):
            return w
    return None


def silences(wav):
    out = subprocess.run(["ffmpeg", "-i", str(wav), "-af", "silencedetect=noise=-38dB:d=0.12", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    st = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", out)]
    en = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", out)]
    return list(zip(st, en))


def cmd_timing():
    c = content()
    asm = json.load(open(ROOT / "assets/audio/vo/assembly.json"))
    vo = ROOT / "assets/audio/voiceover.wav"
    words = transcribe(vo, ROOT / "verify/transcript")
    json.dump(words, open(ROOT / "transcript.json", "w"), indent=1)
    sil = silences(vo)
    L = asm["lines"]
    spans, report, problems = [], [], []
    for k, ln in enumerate(L):
        a, b = ln["start"], ln["start"] + ln["dur"]
        ws = [w for w in words if a - 0.25 <= w["start"] < b + 0.1]
        # speech span from the measured silences (cross-check for whisper's ±0.3s drift)
        # the assembly offsets are sample-exact (gaps are authored); silencedetect is only a cross-check
        s0c = max([e for s, e in sil if e <= a + 0.15] or [a]); s1c = min([s for s, e in sil if s >= b - 0.15] or [b])
        s0, s1 = a, b
        if abs(s0c - a) > 0.15 or abs(s1c - b) > 0.15: report.append("%s: silencedetect span %.2f-%.2f vs assembly %.2f-%.2f" % (ln["id"], s0c, s1c, a, b))
        spans.append({"id": ln["id"], "start": round(s0, 3), "end": round(s1, 3), "asm": [a, round(b, 3)],
                      "w0": ws[0]["start"] if ws else None, "w1": ws[-1]["end"] if ws else None})

    # per-line transcription: an independent clock for the verbs (offset by the known assembly start)
    vdir = ROOT / "assets/audio/vo"

    Y = load48(vo)
    pdir = ROOT / "verify/probe"; pdir.mkdir(parents=True, exist_ok=True)

    def probe(t, word, tag):
        """two-sided boundary probe: the audio cut AT t must start with the verb; the audio before t must not end with it"""
        a = Y[max(0, int(t * SR)):int((t + 1.1) * SR)]
        b = Y[max(0, int((t - 1.3) * SR)):int(t * SR)]
        fa, fb = pdir / ("%s-after.wav" % tag), pdir / ("%s-before.wav" % tag)
        sf.write(fa, a, SR); sf.write(fb, b, SR)
        wa = transcribe(fa, pdir / (tag + "-a"))
        first = norm(wa[0]["text"]) if wa else ""
        same = lambda x: matches(x, word)
        if not same(first):
            return False, (wa[0]["text"] if wa else "-"), "-"
        wb = transcribe(fb, pdir / (tag + "-b"))
        last = norm(wb[-1]["text"]) if wb else ""
        ok_before = not same(last)
        return ok_before, wa[0]["text"], (wb[-1]["text"] if wb else "-")

    STEP = 0.04
    h10 = int(0.01 * SR)
    rms = np.array([np.sqrt(np.mean(Y[i:i + h10] ** 2)) for i in range(0, len(Y) - h10, h10)]) + 1e-9
    db = 20 * np.log10(rms / rms.max())
    speech_ref = float(np.percentile(db[db > -45], 70)) if np.any(db > -45) else -20.0
    QUIET = speech_ref - 24

    def pause_ends(t):
        """Ends of real pauses (>=80 ms below QUIET, longer than a stop closure) in [t-60 ms, t+1.2 s].
        (0.75 s was too short: at speed 1.1 whisper dropped "-board," and the first passing cut sat 0.9 s early.)"""
        i = int(round(t / 0.01)); run = 0; out = []
        for j in range(max(0, i - 6), min(len(db) - 1, i + 120)):
            if db[j] <= QUIET: run += 1
            else:
                if run >= 8: out.append(round(j * 0.01, 3))
                run = 0
        return out

    LW = {}

    def line_words(k):
        """per-line whisper pass (cached), plus Kokoro's leading silence that vo trimmed (to offset it back)"""
        if k not in LW:
            ln = L[k]
            loc = transcribe(vdir / ln["file"], ROOT / ("verify/lines/%s" % ln["id"]))
            a = load48(vdir / ln["file"]); nz = np.where(np.abs(a) > 0.004)[0]
            LW[k] = (loc, max(0, nz[0] - int(0.03 * SR)) / SR if len(nz) else 0)
        return LW[k]

    def word_time(k, word, last=False, after=None):
        """Onset of `word` in line k: mean of the whole-file and the per-line whisper passes (+-0.1-0.3 s; good
        enough for J-cuts, chips and keywords, NOT for verbs -- those use the probe). None if not heard."""
        ln = L[k]; a, b = spans[k]["start"], spans[k]["end"]
        loc, lead = line_words(k)
        full = [w["start"] for w in words if a - 0.25 <= w["start"] <= b + 0.1 and matches(norm(w["text"]), word)]
        per = [ln["start"] + w["start"] - lead for w in loc if matches(norm(w["text"]), word)]
        if after is not None:
            full = [t for t in full if t >= after - 0.15]; per = [t for t in per if t >= after - 0.15]
        pick = (lambda xs: xs[-1] if last else xs[0])
        xs = [pick(x) for x in (full, per) if x]
        return round(float(np.mean(xs)), 3) if xs else None

    def content_words(text):
        return [t for t in re.findall(r"[A-Za-z0-9']+", text) if norm(t) not in STOP]

    def verb_time(k, word):
        ln = L[k]
        w = find_word(words, word, spans[k]["start"], spans[k]["end"])
        loc, lead = line_words(k)
        w2 = find_word(loc, word, 0, 99)
        t1 = round(w["start"], 3) if w else None
        t2 = round(ln["start"] + w2["start"] - lead, 3) if w2 else None
        if t1 is None and t2 is None:
            problems.append("verb '%s' not found in transcript for %s" % (word, ln["id"]))
            return None, {}
        est = float(np.mean([x for x in (t1, t2) if x is not None]))
        tn = norm(word)
        # scan a 40 ms grid from 0.45 s before the estimate: the onset lies just before the FIRST cut whose
        # audio starts with the verb while the audio before the cut does not end with it
        chosen, how, heard, br = round(est, 3), "whisper mean (unverified)", ("-", "-"), None
        prev = None
        t_first = est - 0.45
        for back in range(8):  # the scan must START on a failing cut, or the bracket is open on the left
            ok0, _, _ = probe(round(t_first, 3), word, "%s-%s-b%d" % (ln["id"], tn, back))
            if not ok0: break
            t_first -= 0.2
        for j in range(30):
            t = round(t_first + j * STEP, 3)
            ok, ha, hb = probe(t, word, "%s-%s-g%02d" % (ln["id"], tn, j))
            if ok:
                br = [prev if prev is not None else round(t - STEP, 3), t]
                chosen, how, heard = round(t - STEP / 2, 3), "grid probe, connected speech (±0.02 s)", (ha, hb)
                # if the first passing cut sits in a pause, the onset is where speech energy resumes
                # whisper drops a trailing fragment of the previous word, so the first passing cut can sit inside
                # that word. If a real pause follows and audio cut at its END still starts with the verb, the verb
                # starts there. (A pause AFTER the verb fails this test: that audio starts with the next word.)
                for k2, on in enumerate(pause_ends(t)):
                    if on <= t + 0.01: continue
                    ok2, _, _ = probe(on, word, "%s-%s-p%d" % (ln["id"], tn, k2))
                    if ok2:
                        chosen, how = on, "grid probe + speech onset after pause (±0.01 s)"
                    break
                break
            prev = t
        if abs(chosen - est) > 0.5:
            problems.append("%s: verb '%s' onset %.2f is %.2fs from the whisper estimate %.2f: check verify/probe" % (ln["id"], word, chosen, chosen - est, est))
        if how.startswith("whisper"):
            problems.append("%s: verb '%s' onset not bracketed by the boundary probe; using the whisper mean" % (ln["id"], word))
        return chosen, {"full": t1, "line": t2, "est": round(est, 3), "bracket": br, "how": how,
                        "probe_first_word_after": heard[0], "probe_last_word_before": heard[1]}

    pc = pacing(c)
    n_prob = len(c["problem_lines"])
    ir = n_prob; ib0 = ir + 1; ic = len(L) - 1
    bed_beats = []
    if (ROOT / "assets/audio/beats.json").exists():
        bb = json.load(open(ROOT / "assets/audio/beats.json"))["beats"]
        if bb:
            thr = float(np.percentile([b["strength"] for b in bb], 40))
            bed_beats = [b["t"] for b in bb if b["strength"] >= thr]
    else:
        problems.append("no assets/audio/beats.json: run `pipeline.py beats` (cuts are not beat-snapped)")

    # ---- problem act: chips arrive on words, not on a timer
    chips = [x for x in c["problem_chips"].split("|") if x.strip()]
    cw = [x for x in c.get("problem_chip_words", "").split("|") if x.strip()]
    chip_t, after = [], None
    if cw:
        if len(cw) != len(chips): problems.append("problem_chip_words has %d words for %d chips" % (len(cw), len(chips)))
        for w in cw:
            t = None
            for k in range(n_prob):
                t = word_time(k, w, after=after)
                if t is not None: break
            if t is None: problems.append("chip word '%s' not heard in the problem lines" % w)
            chip_t.append(t); after = t if t is not None else after
    else:  # no chip words: spread the chips over the problem lines' stressed words, one per word
        cand = []
        for k in range(n_prob):
            for w in content_words(L[k]["text"]):
                t = word_time(k, w, after=cand[-1] if cand else None)
                if t is not None: cand.append(t)
        cand = [t for t in cand if t >= 0.9] or cand
        idx = np.linspace(0, len(cand) - 1, len(chips)).round().astype(int) if cand else []
        chip_t = [cand[i] for i in idx]
    chip_t = [t if t is not None else spans[n_prob - 1]["end"] - 0.5 for t in chip_t]
    for i in range(1, len(chip_t)):  # never two pops on one frame
        chip_t[i] = max(chip_t[i], chip_t[i - 1] + 0.12)
    P = {"start": 0.0, "chips": [round(t, 3) for t in chip_t]}

    # ---- reveal
    name_t, _ = verb_time(ir, c.get("reveal_name_word") or c["product_name"].split()[0])
    rv_clauses = re.split(r"(?<=[.,;:!?])\s+", L[ir]["text"])
    pos_t = None
    if len(rv_clauses) > 1:
        cl = content_words(rv_clauses[1]) or rv_clauses[1].split()
        pos_t = word_time(ir, cl[0], after=name_t)
    if pos_t is None: pos_t = round(name_t + 0.6, 3)

    # ---- beats: verbs (probe), keywords (word clock)
    beats = []
    for i, b in enumerate(c["beats"]):
        k = ib0 + i
        tv, ev = verb_time(k, b["verb"])
        lead_in = tv - spans[k]["start"] if tv is not None else None
        if lead_in is not None and lead_in < 0.7:
            problems.append("beat %d: verb '%s' lands %.2fs into its sentence (< 0.7s): the cursor has no time to travel. Rewrite the line." % (i + 1, b["verb"], lead_in))
        kw = b.get("keyword")
        kw_t = None
        if kw:
            kword = (kw.get("word") if isinstance(kw, dict) else None) or b["verb"]
            kw_t = tv if norm(kword) == norm(b["verb"]) else word_time(k, kword)
            if kw_t is None: problems.append("beat %d: keyword word '%s' not heard" % (i + 1, kword))
        beats.append({"verb_t": tv, "kw_t": kw_t, "evidence": ev, "line_start": spans[k]["start"], "line_end": spans[k]["end"]})
    cn, _ = verb_time(ic, c.get("cta_name_word") or c["product_name"].split()[0])
    cv, cev = verb_time(ic, c["cta_verb"])
    cta_words = []
    for w in content_words(c["cta_line"]):
        t = word_time(ic, w, after=cta_words[-1] if cta_words else None)
        if t is None or (cn is not None and t >= cn - 0.05): break
        cta_words.append(t)

    # ---- J-cuts: the exit starts on (just before) the last stressed word of the outgoing line, never before the
    # outgoing scene's result has been on screen result_hold s; the cut (exit end) snaps to a bed beat within beat_snap.
    def result_done(k):
        if k == n_prob - 1: return (max(P["chips"]) if P["chips"] else spans[k]["start"]) - 0.1  # the pile-up's payoff is the collapse itself
        if k == ir: return pos_t + 0.6
        i = k - ib0; b = c["beats"][i]; tv = beats[i]["verb_t"]; s_ = b["screen"]; kind = s_.get("kind")
        if kind == "editor": d = 0.12 + max(0.5, len(s_.get("to", "")) / TYPE_CPS)
        elif kind == "player": d = 0.35 + max(0.5, len(s_.get("comment", "")) / TYPE_CPS)
        elif kind == "stages": d = 1.6
        elif kind == "rows" and b.get("action") == "click": d = 0.3 + 0.14 * len(s_.get("rows", []))
        else: d = 0.4
        done = tv + d
        if beats[i]["kw_t"] is not None: done = max(done, beats[i]["kw_t"] + 0.8)  # the keyword gets read
        return done

    cuts = []
    for k in [n_prob - 1, ir] + [ib0 + i for i in range(len(c["beats"]))]:
        if k == ic: continue
        cw_ = content_words(L[k]["text"])
        lw = cw_[-1] if cw_ else L[k]["text"].split()[-1]
        t_lw = word_time(k, lw, last=True)
        how = "last stressed word '%s'" % lw
        if t_lw is None:
            t_lw = spans[k]["end"] - 0.35; how = "line end - 0.35 (word '%s' not heard)" % lw
        jstart = t_lw - pc["jcut_lead"]
        floor = result_done(k) + pc["result_hold"]
        if jstart < floor:
            jstart = floor; how += ", held for the result"
        cut = jstart + EXIT
        snapped = None
        if bed_beats:
            near = min(bed_beats, key=lambda x: abs(x - cut))
            if abs(near - cut) <= pc["beat_snap"] and near - EXIT >= floor - 0.05:
                snapped = round(near - cut, 3); cut = near
        cut = round(np.round(cut * FPS) / FPS, 4)
        nxt = spans[k + 1]["start"]
        if cut - nxt > pc["late_cut_max"]:
            problems.append("%s: the cut lands %.2fs after the next line starts (> %.2fs): the result outlasts the line. Shorten the result or lengthen the line." % (L[k]["id"], cut - nxt, pc["late_cut_max"]))
        cuts.append({"after": L[k]["id"], "cut": cut, "exit_start": round(cut - EXIT, 3), "word_t": round(t_lw, 3),
                     "how": how, "beat_snap": snapped, "under_speech": bool(cut - EXIT < spans[k]["end"]),
                     "next_line_start": nxt, "lead_into_next": round(nxt - cut, 3)})
    C = {c_["after"]: c_["cut"] for c_ in cuts}
    R = C[L[n_prob - 1]["id"]]; B1 = C[L[ir]["id"]]
    reveal = {"start": R, "name_t": name_t, "pos_t": pos_t, "end": B1}
    prev = B1
    for i, bt in enumerate(beats):
        bt["start"] = prev
        bt["end"] = C[L[ib0 + i]["id"]]
        prev = bt["end"]
        if bt["kw_t"] is not None and bt["kw_t"] > bt["end"] - EXIT - 0.6:
            problems.append("beat %d: the keyword enters %.2fs before the exit starts (< 0.6s): pick an earlier word" % (i + 1, bt["end"] - EXIT - bt["kw_t"]))
    if cn is not None and cn - prev < 1.2:
        problems.append("cta: the product name is spoken %.2fs after the CTA cut (< 1.2s): the people cloud has no time to read before it collapses. Open the line with a short phrase." % (cn - prev))
    if cv is not None and cn is not None and cv - cn < 0.9:
        problems.append("cta: the CTA verb lands %.2fs after the name (< 0.9s): the pill cannot arrive and the cursor cannot travel." % (cv - cn))
    # the one declared stillness beat: after the reveal shapes land, before the name (the dramatic comma), <= 0.9 s
    st0 = R + 0.6
    stillness = [round(st0, 3), round(min(name_t, st0 + 0.9), 3)] if name_t - st0 > 0.2 else None
    total = round(min(asm["total"], spans[ic]["end"] + pc["tail"]), 3)
    total = round(np.ceil(total * FPS) / FPS, 4)
    T = {"fps": FPS, "total": total, "problem": P, "reveal": reveal, "beats": beats,
         "cta": {"start": prev, "name_t": cn, "verb_t": cv, "words": cta_words, "evidence": cev},
         "stillness": stillness, "cuts": cuts, "spans": spans, "pacing": pc}
    json.dump(T, open(ROOT / "timing.json", "w"), indent=1)
    rows = ["| # | chip | verb | whisper full | whisper per-line | Δ passes | onset chosen | method | probe: after / before | sentence | scene |",
            "|---|---|---|---|---|---|---|---|---|---|---|"]
    allb = [(str(i + 1), b["chip"], b["verb"], bt) for i, (b, bt) in enumerate(zip(c["beats"], beats))] + [("CTA", c["cta_label"], c["cta_verb"], dict(T["cta"], line_start=spans[ic]["start"], line_end=spans[ic]["end"], end=total))]
    for n, chip, verb, bt in allb:
        e = bt["evidence"]
        d = abs(e["full"] - e["line"]) if e.get("full") is not None and e.get("line") is not None else float("nan")
        rows.append("| %s | %s | %s | %s | %s | %.3f | **%.3f** | %s | %s / %s | %.2f–%.2f | %.2f–%.2f |" % (
            n, chip, verb, e.get("full"), e.get("line"), d, bt["verb_t"], e.get("how"), e.get("probe_first_word_after"), e.get("probe_last_word_before"),
            bt["line_start"], bt["line_end"], bt["start"], bt["end"]))
    jrows = ["", "| cut after | exit starts | cut | J-cut word onset | how | beat snap (s) | under speech | next line starts (cut +) |", "|---|---|---|---|---|---|---|---|"]
    for x in cuts:
        jrows.append("| %s | %.3f | **%.3f** | %.3f | %s | %s | %s | %+.3f |" % (x["after"], x["exit_start"], x["cut"], x["word_t"], x["how"],
                     "%+.3f" % x["beat_snap"] if x["beat_snap"] is not None else "—", "yes" if x["under_speech"] else "no", x["lead_into_next"]))
    jrows.append("\nchips on words: %s · reveal positioning line on %.3f · declared stillness %s" % (P["chips"], pos_t, stillness))
    (ROOT / "verify").mkdir(exist_ok=True)
    open(ROOT / "verify/sync-plan.md", "w").write("\n".join(rows + jrows) + "\n\n" + "\n".join("- PROBLEM: " + p for p in problems) + "\n")
    print("\n".join(rows + jrows)); print("total", total)
    for p in problems: print("PROBLEM:", p)
    if any("not found" in p for p in problems): sys.exit(2)


# ---------------------------------------------------------------- mix
def place(buf, clip, t, gain):
    i = int(round(t * SR))
    if i >= len(buf) or i + len(clip) <= 0: return
    if i < 0: clip, i = clip[-i:], 0
    n = min(len(clip), len(buf) - i)
    buf[i:i + n] += clip[:n] * gain


def cmd_mix():
    c = content(); T = json.load(open(ROOT / "timing.json"))
    total = T["total"]; N = int(np.ceil(total * SR))
    vo = load48(ROOT / "assets/audio/voiceover.wav")[:N]
    vo = np.pad(vo, (0, N - len(vo)))
    # bed: loop/trim the owned 120 BPM track, fade in/out
    m = load48(MUSIC)
    if len(m) < N: m = np.tile(m, int(np.ceil(N / len(m))))
    start = int(float(os.environ.get("MUSIC_OFFSET", "0")) * SR)
    bed = m[start:start + N]; bed = np.pad(bed, (0, N - len(bed)))
    fi, fo = int(0.3 * SR), int(1.5 * SR)
    bed[:fi] *= np.linspace(0, 1, fi); bed[-fo:] *= np.linspace(1, 0, fo) ** 1.5
    # sidechain-style duck: the bed dips DUCK_DB only under words (attack 50 ms, release 150 ms), so it fills every gap
    duck_db = float(os.environ.get("DUCK_DB", "7"))
    h = int(0.01 * SR); nfr = N // h
    rms = np.sqrt(np.mean(vo[:nfr * h].reshape(nfr, h) ** 2, axis=1)) + 1e-9
    talk = (20 * np.log10(rms / rms.max()) > -38).astype(np.float64)   # 10 ms frames with speech
    target = 10 ** (-duck_db * talk / 20)
    g = np.empty(nfr); cur_g = 1.0
    a_att, a_rel = np.exp(-0.01 / 0.05), np.exp(-0.01 / 0.15)
    for j in range(nfr):
        al = a_att if target[j] < cur_g else a_rel
        cur_g = al * cur_g + (1 - al) * target[j]; g[j] = cur_g
    gain = np.interp(np.arange(N), np.arange(nfr) * h + h / 2, g)
    bed = bed * gain.astype(np.float32)
    sfx = np.zeros(N, np.float32)
    S = {n: load48(SFX / (n + ".mp3")) for n in ["click", "click-soft", "pop", "whoosh-short", "sparkle", "chime", "typing", "impact-bass-1"]}
    WPK = int(np.argmax(np.abs(S["whoosh-short"]))) / SR   # the whoosh's own peak lands ON the cut
    cues = []
    def cue(name, t, g): place(sfx, S[name], t, g); cues.append((round(t, 3), name, g))
    for t in T["problem"]["chips"]: cue("pop", t, 0.28)
    for x in T.get("cuts", []): cue("whoosh-short", x["cut"] - WPK, 0.34)     # a transition SFX on every scene change
    cue("impact-bass-1", T["reveal"]["name_t"], 0.22); cue("sparkle", T["reveal"]["name_t"] + 0.05, 0.16)
    for i, (b, bt) in enumerate(zip(c["beats"], T["beats"])):
        tv = bt["verb_t"]
        cue("click", tv, 0.55)
        if bt.get("kw_t") is not None: cue("click-soft", bt["kw_t"], 0.22)
        kind = b["screen"].get("kind")
        if kind == "editor":
            d = max(0.5, len(b["screen"].get("to", "")) / TYPE_CPS); t0 = tv + 0.12
        elif kind == "player":
            d = max(0.5, len(b["screen"].get("comment", "")) / TYPE_CPS); t0 = tv + 0.35
        else:
            d = 0
        if d:
            ty = S["typing"]; ty = np.tile(ty, int(np.ceil(d * SR / len(ty))))[:int(d * SR)]
            r = int(0.05 * SR); ty[-r:] *= np.linspace(1, 0, r)
            place(sfx, ty, t0, 0.22); cues.append((round(t0, 3), "typing %.2fs" % d, 0.22))
        if kind in ("rows",) and b.get("action") == "click":
            for j in range(len(b["screen"].get("rows", []))): cue("pop", tv + 0.18 + j * 0.14, 0.12)
        if kind == "stages": cue("chime", min(bt["end"] - EXIT - 0.3, tv + 2.4), 0.14)
    for j, t in enumerate(T["cta"].get("words", [])): cue("pop", t, 0.14)
    cue("sparkle", T["cta"]["name_t"], 0.16)
    cue("click", T["cta"]["verb_t"], 0.55)
    mix = vo * 1.0 + bed * float(os.environ.get("BED_GAIN", "0.2")) + sfx
    pre = ROOT / "assets/audio/premix.wav"
    sf.write(pre, np.stack([mix, mix], 1), SR, subtype="FLOAT")
    # two-pass loudnorm, then a true-peak limiter with headroom for the AAC encode
    target = float(os.environ.get("LUFS", "-14.0"))
    st = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(pre), "-af", "loudnorm=I=%s:TP=-3.0:LRA=11:print_format=json" % target, "-f", "null", "-"],
                        capture_output=True, text=True).stderr
    js = json.loads(st[st.rindex("{"):st.rindex("}") + 1])
    af = ("loudnorm=I={t}:TP=-3.0:LRA=11:measured_I={I}:measured_TP={TP}:measured_LRA={LRA}:measured_thresh={th}:offset={off}:linear=true,"
          "alimiter=limit=0.60:attack=2:release=60:level=false,aresample=48000").format(
        t=target, I=js["input_i"], TP=js["input_tp"], LRA=js["input_lra"], th=js["input_thresh"], off=js["target_offset"])
    run(["ffmpeg", "-y", "-v", "error", "-i", str(pre), "-af", af, "-ar", "48000", "-c:a", "pcm_s16le", str(ROOT / "assets/audio/mix.wav")])
    # loudnorm in linear mode stops short when the true-peak ceiling binds; correct the remainder with gain into a
    # limiter, measured on the WAV. The AAC encode then costs ~0.3-0.5 LU, so aim a little hot (-13.7).
    out = ROOT / "assets/audio/mix.wav"
    for _ in range(2):
        st = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(out), "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True).stderr
        I = float(re.findall(r"I:\s+(-?[\d.]+) LUFS", st)[-1])
        g = (target + 0.3) - I
        if abs(g) < 0.15: break
        tmp = ROOT / "assets/audio/mix-tmp.wav"
        run(["ffmpeg", "-y", "-v", "error", "-i", str(out), "-af", "volume=%.2fdB,alimiter=limit=0.60:attack=2:release=60:level=false" % g, "-ar", "48000", "-c:a", "pcm_s16le", str(tmp)])
        tmp.replace(out)
    json.dump({"cues": cues, "bed": MUSIC, "bed_gain": os.environ.get("BED_GAIN", "0.2"), "target_lufs": target,
               "duck": {"db": duck_db, "attack_ms": 50, "release_ms": 150, "detector": "VO 10 ms RMS > -38 dB re peak"}},
              open(ROOT / "verify/audio-cues.json", "w"), indent=1)
    print("mix.wav written; %d cues" % len(cues))


# ---------------------------------------------------------------- variables / index
VAR_KEYS = ["product_name", "wordmark_accent", "positioning_line", "problem_chips", "cta_label", "cta_url", "cta_verb", "disclaimer",
            "avatars", "persona_initials", "app_nav", "app_steps", "mark_src", "mascot_src", "font_ui", "font_display"]


def cmd_vars():
    c = content(); T = json.load(open(ROOT / "timing.json"))
    v = {k: c.get(k, "") for k in VAR_KEYS}
    v.update({k: c[k] for k in c if k.startswith("color_")})
    def kwtext(b):
        kw = b.get("keyword")
        return (kw.get("text") if isinstance(kw, dict) else kw) or ""
    v["beats"] = json.dumps([dict({kk: b[kk] for kk in ("chip", "verb", "action", "target", "screen")}, keyword=kwtext(b)) for b in c["beats"]], ensure_ascii=False)
    T2 = {k: T[k] for k in ("fps", "total", "problem", "reveal", "beats", "cta")}
    T2["beats"] = [{k: b.get(k) for k in ("start", "end", "verb_t", "kw_t")} for b in T["beats"]]
    T2["cta"] = {k: T["cta"].get(k) for k in ("start", "name_t", "verb_t", "words")}
    T2["stillness"] = T.get("stillness")
    v["timing"] = json.dumps(T2)
    json.dump(v, open(ROOT / "variables.json", "w"), indent=1, ensure_ascii=False)
    print("variables.json: %d keys" % len(v))


LABELS = {"beats": "Feature beats (JSON)", "timing": "Clock from the VO transcript (JSON, written by tools/pipeline.py timing)"}


def minified_engine():
    """The engine is inlined (the bundler drops external local <script src>), minified so lint's file-size rule stays quiet."""
    esb = str(REPO / "node_modules/.bin/esbuild")
    return run([esb, str(ROOT / "engine.js"), "--minify", "--target=es2019", "--legal-comments=none"]).strip()


def cmd_index():
    v = json.load(open(ROOT / "variables.json")); T = json.loads(v["timing"])
    decl = []
    for k, val in v.items():
        typ = "color" if k.startswith("color_") else "string"
        decl.append({"id": k, "type": typ, "label": LABELS.get(k, k.replace("_", " ")), "default": val})
    attr = json.dumps(decl, ensure_ascii=False).replace("&", "&amp;").replace('"', "&quot;")
    html = open(ROOT / "tools/index.tpl").read()
    html = html.replace("__VARS__", attr).replace("__TOTAL__", "%.4f" % T["total"]).replace("__ENGINE__", minified_engine())
    open(ROOT / "index.html", "w").write(html)
    print("index.html written, duration %.3f" % T["total"])


if __name__ == "__main__":
    cmds = {"vo": cmd_vo, "beats": cmd_beats, "timing": cmd_timing, "mix": cmd_mix, "vars": cmd_vars, "index": cmd_index}
    arg = sys.argv[1] if len(sys.argv) > 1 else "all"
    for name in (["vo", "beats", "timing", "mix", "vars", "index"] if arg == "all" else [arg]):
        cmds[name]()
