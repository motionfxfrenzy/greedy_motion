# 🎬 Vox Animation — make an explainer video with Claude

**What this is.** A studio-in-a-folder. You bring an idea; Claude turns it
into a finished ~60-second narrated motion-graphics video in the style of
a Vox explainer — bold editorial collage, documentary narrator, tight
fact-driven script.

**How it works** — about 15 minutes of your time:

| Step | What happens | Who does it |
|---|---|---|
| 1 | You give an idea (or ask for a trending one). Claude writes the angle and script. | Claude |
| 2 | **Style key** — Claude gives you one image prompt; you run it in your image generator. This image locks the look of the whole video. | You (1 generation) |
| 3 | **Scenes** — Claude gives you one prompt per 10-second scene; you run each in your video generator with the style key attached, and save them as `block01.mp4`, `block02.mp4`, … | You (6 generations) |
| 4 | **Voiceover** — Claude generates the narration on your machine, free. You just pick the voice. | Claude |
| 5 | **Final cut** — Claude stitches scenes + narration into one MP4. | Claude |

**What you need:**
- Claude Code, with this folder opened as a project
- Any AI image + video generator that accepts a reference image
  (Higgsfield, Veo, Kling, Runway, …) — about 6 video generations per video
- Two small free tools (ffmpeg, edge-tts) — Claude checks and offers to
  install them for you

**To start:** open this folder in Claude Code and say **"let's make a
video."** Claude guides every step; you never need to touch anything
technical.

Every video you make is kept in `projects/<name>/` — script, prompts,
clips, and the finished `final.mp4`.
