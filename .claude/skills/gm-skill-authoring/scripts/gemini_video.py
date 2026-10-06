#!/usr/bin/env python3
"""Gemini video-understanding pass for /gm-skill-authoring.

Uploads a reference video to the Gemini Files API, asks Gemini (3.1 Pro by default) for a structured,
timestamped shot / audio / intent analysis, and writes:
  <out>/gemini-analysis.json   structured result (schema below)
  <out>/gemini-analysis.md     the same, readable
  <out>/calls.jsonl            one line per paid call: model, tokens, cost

The key is read from GEMINI_API_KEY in the environment, else from backend/.env. It is never printed or written.
Stdlib only (no requests). Usage:
  python3 .claude/skills/gm-skill-authoring/scripts/gemini_video.py reference.mp4 --out analysis/ [--fps 4] [--model gemini-3.1-pro-preview]
"""
import argparse, json, mimetypes, os, pathlib, sys, time, urllib.error, urllib.request

REPO = pathlib.Path(__file__).resolve().parents[4]
BASE = "https://generativelanguage.googleapis.com"
# $ per 1M tokens, prompts <= 200k. Source: https://ai.google.dev/gemini-api/docs/pricing (updated 2026-10-01, fetched 2026-10-04)
PRICE = {"gemini-3.1-pro-preview": (2.00, 12.00), "gemini-3.5-flash": (1.50, 9.00), "gemini-3.8-flash": (0.75, 3.75)}

SCHEMA = {
    "type": "object",
    "required": ["summary", "device", "clock", "rules", "shots", "audio", "on_screen_text", "palette", "pacing"],
    "properties": {
        "summary": {"type": "string", "description": "What the film is, length, format, in 2-3 sentences."},
        "device": {"type": "string", "description": "One sentence: the single idea that makes this film work."},
        "clock": {"type": "string", "description": "What the timing follows: music beats, voiceover, or a fixed cut plan. Tempo/BPM if music."},
        "rules": {"type": "array", "items": {"type": "string"}, "description": "The 1-2 craft rules that, if broken, would kill the film."},
        "shots": {"type": "array", "items": {"type": "object",
            "required": ["start", "end", "on_screen", "camera", "subject_motion", "transition_out", "dimension"],
            "properties": {
                "start": {"type": "string", "description": "MM:SS.ss"}, "end": {"type": "string", "description": "MM:SS.ss"},
                "on_screen": {"type": "string"},
                "camera": {"type": "string", "description": "Move, direction, speed, lens feel."},
                "subject_motion": {"type": "string"},
                "transition_out": {"type": "string", "description": "Hard cut, whip (direction), match-cut (what to what), push-through, crossfade, etc."},
                "dimension": {"type": "string", "enum": ["2D", "3D", "live-action", "mixed"]},
                "accent_color_use": {"type": "string"},
                "text": {"type": "string", "description": "Exact on-screen words in this shot, if any."}}}},
        "audio": {"type": "object", "required": ["music", "sfx", "voiceover"], "properties": {
            "music": {"type": "string", "description": "Genre, mood, instrumentation, tempo, structure, where the drop/hits are (MM:SS.ss)."},
            "sfx": {"type": "array", "items": {"type": "object", "properties": {
                "time": {"type": "string"}, "sound": {"type": "string"}, "synced_to": {"type": "string"}}}},
            "voiceover": {"type": "string", "description": "Verbatim transcript with timestamps, or 'none'."}}},
        "on_screen_text": {"type": "array", "items": {"type": "object", "properties": {
            "time": {"type": "string"}, "text": {"type": "string"}, "style": {"type": "string"}}}},
        "palette": {"type": "string", "description": "Ground, ink, accents (approximate hex) and where each accent is used."},
        "pacing": {"type": "string", "description": "Median/shortest shot length, where it speeds up or holds still."},
        "uncertain": {"type": "array", "items": {"type": "string"}, "description": "Anything you could not determine reliably (e.g. very fast cuts between sampled frames)."}}}

PROMPT = """You are a motion-design director reverse-engineering this reference film so a team can build a
*reusable template of its structure* (not a copy of its content). Watch the full video and listen to the audio.

Return the JSON schema exactly. Requirements:
- Timestamps as MM:SS.ss. Be as precise as the frames allow; list a shot boundary at every cut, whip or match-cut.
- For each shot, describe the camera vector (axis, direction, speed) and how the shot hands off to the next one.
- Mark each shot 2D, 3D, live-action or mixed.
- Audio: describe the music (tempo, mood, structure, drop/hit times), every audible SFX and what visual it is synced to,
  and transcribe any voiceover verbatim.
- Record all on-screen text verbatim.
- 'device' and 'rules' are the most important fields: why does this film work, and which 1-2 rules hold it together?
- Put anything you are unsure about in 'uncertain' instead of guessing."""


def key():
    if os.environ.get("GEMINI_API_KEY"):
        return os.environ["GEMINI_API_KEY"].strip()
    env = REPO / "backend/.env"
    for line in env.read_text().splitlines():
        if line.strip().startswith("GEMINI_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("GEMINI_API_KEY not found in environment or backend/.env")


def req(url, data=None, headers=None, method=None):
    r = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(r, timeout=600) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def upload(path, k):
    raw = path.read_bytes()
    mt = mimetypes.guess_type(path.name)[0] or "video/mp4"
    st, hd, body = req(f"{BASE}/upload/v1beta/files", json.dumps({"file": {"display_name": path.name}}).encode(), {
        "x-goog-api-key": k, "Content-Type": "application/json", "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start", "X-Goog-Upload-Header-Content-Length": str(len(raw)),
        "X-Goog-Upload-Header-Content-Type": mt}, "POST")
    url = {k_.lower(): v for k_, v in hd.items()}.get("x-goog-upload-url")
    if st != 200 or not url:
        sys.exit(f"upload start failed: HTTP {st} {body[:300]!r}")
    st, _, body = req(url, raw, {"Content-Length": str(len(raw)), "X-Goog-Upload-Offset": "0",
                                 "X-Goog-Upload-Command": "upload, finalize"}, "POST")
    if st != 200:
        sys.exit(f"upload failed: HTTP {st} {body[:300]!r}")
    f = json.loads(body)["file"]
    while f.get("state") == "PROCESSING":
        time.sleep(3)
        _, _, body = req(f"{BASE}/v1beta/{f['name']}", headers={"x-goog-api-key": k})
        f = json.loads(body)
    if f.get("state") != "ACTIVE":
        sys.exit(f"file not ACTIVE: {f.get('state')} {f.get('error')}")
    return f, mt


def to_md(a):
    L = [f"# Gemini analysis\n", f"**Summary:** {a['summary']}\n", f"**Device:** {a['device']}\n",
         f"**Clock:** {a['clock']}\n", "**Rules:**"] + [f"- {r}" for r in a["rules"]]
    L += ["", "| # | In | Out | Dim | On screen | Camera | Transition out | Text |", "|---|---|---|---|---|---|---|---|"]
    for i, s in enumerate(a["shots"], 1):
        cell = lambda v: str(v or "").replace("|", "/").replace("\n", " ")
        L.append(f"| {i} | {s['start']} | {s['end']} | {s['dimension']} | {cell(s['on_screen'])} | {cell(s['camera'])} | "
                 f"{cell(s['transition_out'])} | {cell(s.get('text'))} |")
    au = a["audio"]
    L += ["", f"**Music:** {au['music']}", "", "**SFX:**"] + [f"- {x.get('time')}: {x.get('sound')} → {x.get('synced_to')}" for x in au["sfx"]]
    L += ["", f"**Voiceover:** {au['voiceover']}", "", "**On-screen text:**"]
    L += [f"- {t.get('time')}: \"{t.get('text')}\" ({t.get('style')})" for t in a["on_screen_text"]]
    L += ["", f"**Palette:** {a['palette']}", "", f"**Pacing:** {a['pacing']}"]
    if a.get("uncertain"):
        L += ["", "**Uncertain:**"] + [f"- {u}" for u in a["uncertain"]]
    return "\n".join(L) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--out", default="analysis")
    ap.add_argument("--fps", type=float, default=4.0, help="frames/sec Gemini samples (default 4; 1 is Gemini's default and misses fast cuts)")
    ap.add_argument("--model", default="gemini-3.1-pro-preview")
    ap.add_argument("--resolution", default="MEDIA_RESOLUTION_HIGH", choices=["MEDIA_RESOLUTION_LOW", "MEDIA_RESOLUTION_MEDIUM", "MEDIA_RESOLUTION_HIGH"])
    a = ap.parse_args()
    out = pathlib.Path(a.out); out.mkdir(parents=True, exist_ok=True)
    k = key()
    t0 = time.time()
    f, mt = upload(pathlib.Path(a.video), k)
    body = {"contents": [{"role": "user", "parts": [
                {"fileData": {"fileUri": f["uri"], "mimeType": mt}, "videoMetadata": {"fps": a.fps}},
                {"text": PROMPT}]}],
            "generationConfig": {"responseMimeType": "application/json", "responseJsonSchema": SCHEMA,
                                 "mediaResolution": a.resolution}}
    st, _, raw = req(f"{BASE}/v1beta/models/{a.model}:generateContent", json.dumps(body).encode(),
                     {"x-goog-api-key": k, "Content-Type": "application/json"}, "POST")
    req(f"{BASE}/v1beta/{f['name']}", headers={"x-goog-api-key": k}, method="DELETE")  # don't leave the upload on Google
    secs = round(time.time() - t0, 1)
    if st != 200:
        sys.exit(f"generateContent failed: HTTP {st} {raw[:600]!r}")
    j = json.loads(raw)
    um = j.get("usageMetadata", {})
    tin, tout = um.get("promptTokenCount", 0), um.get("candidatesTokenCount", 0) + um.get("thoughtsTokenCount", 0)
    pin, pout = PRICE.get(a.model, (0, 0))
    cost = round(tin / 1e6 * pin + tout / 1e6 * pout, 4)
    text = "".join(p.get("text", "") for p in j["candidates"][0]["content"]["parts"])
    result = json.loads(text)
    (out / "gemini-analysis.json").write_text(json.dumps(result, indent=2))
    (out / "gemini-analysis.md").write_text(to_md(result))
    rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "model": a.model, "purpose": "reference video analysis",
           "video": pathlib.Path(a.video).name, "fps": a.fps, "resolution": a.resolution, "in_tokens": tin,
           "out_tokens_incl_thinking": tout, "unit_price_per_mtok": [pin, pout], "cost": cost, "secs": secs}
    with open(out / "calls.jsonl", "a") as fh:
        fh.write(json.dumps(rec) + "\n")
    print(json.dumps({k_: rec[k_] for k_ in ("model", "fps", "in_tokens", "out_tokens_incl_thinking", "cost", "secs")}))


if __name__ == "__main__":
    main()
