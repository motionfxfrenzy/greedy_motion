# 🎬 Motion Design — Paper-Cut (Prompt Mode)

Drop one image → get a handcrafted **stop-motion paper-collage** video, made with **whatever
AI tools you already use**. No Higgsfield, no credits. The skill writes the prompts; you run
the generations.

---

## Install (60 seconds)

1. **Unzip** this folder.
2. **Open it in Claude Code** (as its own project).
3. Run:
   ```
   /motion-design
   ```

That's it — no Higgsfield, no setup. You just need an image model and a video model you
already use.

---

## How it works

1. It asks you to **name the project** and drop your image into `<project>/reference/`.
2. It looks at your image and **hands you a paper-cut prompt**. Run it in your image tool
   (ChatGPT image, Gemini / Nano Banana, Midjourney…), save the result back into `reference/`.
3. It **hands you a 9-panel sheet prompt**. Run it, save the sheet back.
4. It **hands you the animation prompt**. Run it in your video tool (Seedance, Kling, Veo,
   Sora, Hailuo…) with the sheet attached → your final clip.

Three prompts, one guided flow.

---

## No Claude Code? Use the prompts directly

Everything also works **without Claude Code**: open `prompts/START-HERE.md`, paste the single
**Guide Prompt** into ChatGPT / Claude / Gemini, drop your image, and it walks you through the
same three steps. (Or use `prompts/1-`, `2-`, `3-…` individually.)

---

## Tips

- The more finished/poster-like your source image, the cleaner the result.
- Keep actions simple — one clear beat ("drives off", "lifts away", "kick → scatter").
- Recommended video settings: **10s, 720p**, audio on.
- If a render comes out rough, run it again — these models have natural variance.
