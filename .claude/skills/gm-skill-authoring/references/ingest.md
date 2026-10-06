# Ingesting a reference video

Run these from the experiment folder (`experiments/skills/<name>/`). Copy the reference into
`reference/` first; never into the skill folder.

```bash
REF=reference/reference.mp4

# 1. Basics: duration, size, fps, audio present
ffprobe -v error -show_entries format=duration:stream=codec_type,width,height,r_frame_rate -of compact "$REF"

# 2. Cut points (scene score > 0.25). Tune 0.15–0.35: whips and match-cuts score low.
ffmpeg -i "$REF" -vf "select='gt(scene,0.25)',showinfo" -an -f null - 2>&1 | grep -o "pts_time:[0-9.]*"

# 3. Contact sheets: 1 fps overview, 4 fps around fast sections
ffmpeg -v error -y -i "$REF" -vf "fps=1,scale=480:-1,tile=5x5" -frames:v 1 reference/sheet-1fps.jpg
ffmpeg -v error -y -ss 2 -t 4 -i "$REF" -vf "fps=4,scale=480:-1,tile=4x4" -frames:v 1 reference/sheet-4fps-2s.jpg

# 4. Frames either side of each cut (for the camera vector and transition type)
ffmpeg -v error -y -ss <cut-0.067> -i "$REF" -frames:v 2 reference/cut_<n>_%d.jpg

# 5. Beat grid and drop (music-clocked films)
ffmpeg -v error -y -i "$REF" -vn -ac 2 -ar 44100 reference/audio.wav
worker/node_modules/.bin/hyperframes beats reference/audio.wav

# 6. Loudness and dynamics
ffmpeg -nostats -i "$REF" -af ebur128=peak=true -f null - 2>&1 | grep -A12 Summary
```

## Gemini pass (watches and listens to the whole video)

The ffmpeg steps above give exact measurements. Gemini adds what frame dumps can't: the music's
mood and structure, SFX sync, a voiceover transcript, on-screen text, and a read of the creative
intent. Run it on every reference:

```bash
python3 .claude/skills/gm-skill-authoring/scripts/gemini_video.py "$REF" --out analysis/ --fps 4
```

- **Key:** `GEMINI_API_KEY` from the environment, or else `backend/.env`. It is never printed.
- **Output:** `analysis/gemini-analysis.json` and `.md`, plus a cost line in `analysis/calls.jsonl`.
- **Model:** `gemini-3.1-pro-preview` by default, at $2 / $12 per million tokens. A 30s reference
  at 4 fps costs a few cents. Use `--model gemini-3.8-flash` for a cheaper first look.
- **Frame rate:** `--fps 4` is the default because Gemini's own default of 1 fps blurs whips and
  match-cuts together. Go up to 8 for very fast reels.
- **Cleanup:** the upload is deleted from Google after the call.

### Merge the two passes

Gemini **describes**; ffmpeg **measures**. When writing `SHOTS.md`:

| Field | Trust |
|---|---|
| Cut times, motion vector at each cut, colours, type sizes, beat grid, loudness | **ffmpeg / `hyperframes beats`** |
| Music mood and structure, SFX sync, VO transcript, on-screen text, device and intent | **Gemini**, checked against frames |

Where they disagree (a cut Gemini missed, or a hit ffmpeg can't hear), extract frames at that
moment and decide by looking. Record the disagreements in `analysis/SHOTS.md`, because they show
where each tool is weak.

## What to record in `analysis/SHOTS.md`

```
DEVICE: <one sentence: why this film works>
CLOCK:  <ledger | voiceover transcript | beat grid>, <tempo / drop / VO length>
RULE 1: <the craft law that, broken, kills the film>
RULE 2: <the second one>

| # | in | out | on screen | camera vector (axis, sign, lens feel) | transition out | accent where | largest type px |
```

Measure, don't eyeball:

- **Shot length:** take it from the cut points, then work out the median and the shortest.
- **Copy budgets:** count the characters of every on-screen string; the budget is that count
  rounded up about 20%.
- **Read time:** how long each string is fully legible on screen.
- **Accent discipline:** the share of frames where the accent colour appears, and on what.
- **Motion vector at each cut:** compare the two frames either side. Is the subject moving, on
  which axis, and with what sign?
