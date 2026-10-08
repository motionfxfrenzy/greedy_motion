---
name: motion-design
description: >
  Drop one image and get the prompts to make a handcrafted paper-cut stop-motion video in ANY image/video tools you already use. Trigger whenever the user wants a paper-cut / torn-paper / paper-collage / stop-motion assembly / "motion design" animation and does NOT have Higgsfield — this skill writes the prompts, the user runs the generations in their own tools. Standalone, no Higgsfield, no credits.
---

# Motion Design — Paper-Cut (Prompt Mode)

Drop one image → this walks you through making a handcrafted **stop-motion paper-collage**
video using **whatever AI tools you already have**. It does NOT generate anything itself —
it **looks at what you drop and writes the exact prompt** for each step. You run that prompt
in your own image/video model, drop the result back, and it hands you the next one.

Three prompts, one workflow: **paper-cut image → 9-panel sheet → animation.** No Higgsfield,
no credits.

## How to run this skill (read first)

- **Start silently.** No "I'll follow the skill" / "let me check setup" preamble — open at
  Step 1 by asking the project name.
- **Every invocation starts at Step 1.**
- **Formatting matters a lot here.** Every prompt goes in its own fenced ```code block``` so
  it's one-click copyable. Every hand-off is a clean **brief** (see the exact shapes below) —
  short labelled lines, blank lines for breathing room, never a wall of text.
- This skill only **reads images and writes prompts** — it never runs a generation.

---

## Step 1 — Name the project, then drop the image

Ask only this first:

> **What should we call this project?** (e.g. `wolf`, `ferrari`, `football` — whatever you're making)

Slug it (lowercase-hyphen) and create the folder, then capture the **full absolute path** so
you can show the user exactly where to drop:

```bash
mkdir -p "<project>/reference" && echo "$(pwd)/<project>/reference/"
```

Show this message — note the **full path on its own line, with blank lines around it**:

> ✅ Project **`<project>`** created.
>
> Drop the image you want to animate into:
>
> &nbsp;&nbsp;&nbsp;`/full/absolute/path/<project>/reference/`
>
> Any image works — a photo, poster, product, or artwork.
> Once it's in, just say **done**.

On "done", detect the newest file and **look at it**:

```bash
ls -t "<project>/reference/" | head -5
```

The file at the **top of `ls -t` (most recently added) is the subject** they just dropped.
**Remember the filenames you've seen** — at every later step, the *new* file at the top of
`ls -t` is the result of the prompt you just handed over (so the original never gets confused
with the paper-cut, and the paper-cut never gets confused with the sheet).

---

## Step 2 — Hand over the PAPER-CUT prompt

Look at the subject image and write ONE image-generation prompt that recreates it as a
torn-paper collage. Put it in a code block, one paragraph:
- First, concisely describe what's actually in the image: subject, pose, key colors, layout,
  any text/numbers.
- Then append this STYLE BLOCK verbatim: *"Built entirely from layered cut-and-torn paper pieces: every shape is a separate flat paper cutout with rough torn edges, visible paper grain and fibre texture, and a hard drop shadow beneath it. Small rough white negative-space slivers show between the pieces. Muted, tactile, slightly desaturated color treatment. A mosaic of overlapping paper facets, like a real handmade paper artwork photographed under soft directional light. No smooth gradients, no digital flatness, no glossy 3D — it must look like real cut paper."*
- Keep the subject, composition, and colors; change only the material to paper.

Present it EXACTLY in this shape (heading → code block → labelled brief):

> Here's your **paper-cut prompt** — it recreates [one-line description of their image] as a
> torn-paper collage:
>
> ```
> [the prompt]
> ```
>
> **Now generate it:**
>
> - 🎨 **Platform:** your preferred image generation platform
> - 🤖 **Model:** **GPT Image 2.0**
> - 📎 **Attach:** your original image
> - 💾 **Save the result** into `/full/path/<project>/reference/` and say **done**

On "done", `ls -t` the folder → the new top file is the paper-cut image → look at it.

---

## Step 3 — Action

> **Every paper-cut motion starts with the assembly** — the scene builds itself out of torn
> paper, then settles.
>
> **After it's assembled, you can add motion** — e.g. *the car drives off · the figure runs
> and lifts away · a ball is kicked and confetti scatters.*
>
> Want to add motion? Tell me what happens — or say **no** for pure assembly.

Store as the action note.

---

## Step 4 — Hand over the SHEET prompt

Write ONE image-generation prompt for a clean **storyboard sheet** — a 3×3 grid of 9 panels
showing the scene assembling piece by piece. Code block, one paragraph:
- NO text, NO labels, NO captions, NO numbers anywhere in the grid.
- Build far-to-near across the panels: Panel 1 a near-empty frame with the first background
  pieces (sky/back wall) sliding in; then ground rises in; environment & set pieces slide in;
  background crowd builds; props settle; the hero figure(s) assemble part by part; if an
  action was requested, the second-to-last panel shows that beat; the final panel is the
  complete composition matching the paper-cut image.
- Keep the SAME paper-cut look in every panel (torn edges, grain, hard shadows, white slivers,
  same palette). End by restating: no text or writing in any panel.

Present it EXACTLY in this shape:

> Here's your **storyboard-sheet prompt** — a 9-panel grid showing the whole assembly:
>
> ```
> [the prompt]
> ```
>
> **Now generate it:**
>
> - 🎨 **Platform:** your preferred image generation platform
> - 🤖 **Model:** **GPT Image 2.0**
> - 📐 **Aspect ratio:** the format you want the final video — **16:9 / 9:16 / 1:1**
> - 📎 **Attach:** the **paper-cut image you just generated**
> - 💾 **Save the sheet** into `/full/path/<project>/reference/` and say **done**

On "done", `ls -t` → the new top file is the sheet → look at it.

---

## Step 5 — Hand over the ANIMATION prompt

Write ONE animation prompt as a single paragraph in a code block, in this FIXED ORDER. The
OPENING line and the three CLOSING blocks are verbatim constants — never reword. Describe only
what's visible in the scene.

1. OPENING (verbatim): *"Animate this as a handcrafted stop-motion paper collage assembly. Every element must enter the frame as a flat pre-cut torn paper piece pushed in from outside the frame."*
2. ASSEMBLY BODY — silently sort back-to-front, then describe entrances in that order: back layer (sky/wall) from above and the sides; ground from below in layered strips; environment & set pieces from the sides and top; background crowd row by row; props settle; hero figure(s) LAST, part by part (base-up: legs/feet → clothing → torso → arms → hands → head → features → hair last; for a face: jaw → cheeks → nose → forehead → eyes with tiny white catchlight flecks → eyebrows → hair). Each object gets a hard paper shadow beneath it; details/numbers/logos enter as separate small cutouts.
3. OPTIONAL ACTION BEAT — only if requested. After assembly, introduced with *"As the final beat…"*. One clear beat. Paper-legal verbs only (slide, drop, rotate, tumble, lift, plant, scatter, tip, swing, snap forward, drive off); locomotion = *"flat cutout limbs sliding and swapping mid-stride in choppy stop-motion steps."* Never morph/fold/bend/smooth. Chain cause→effect (kick → ball → net → confetti; grab string → balloon lifts figure → out of frame; engine starts → car drives off → paper exhaust puff). Payoff = "tiny scattered paper flecks." No action → end on *"all pieces settle and lock into place with tiny staggered adjustments."*
4. STYLE (verbatim): *"Motion should feel tactile, slightly imperfect, editorial, and stop-motion realistic, with tiny misalignments, staggered timing, hard shadows, rough white torn edges, overlapping paper layers, and visible paper texture."*
5. NEGATIVE (verbatim): *"No folding, no morphing, no in-place drawing, no smooth digital animation. Every piece is a pre-made flat cutout sliding, rotating, or dropping into place."*
6. SOUND (verbatim): *"Sound design: ASMR paper-only foley, including soft paper slides, taps, shuffles, drops, and friction. No music, no voice, no ambient sound, no extra effects."*

Present it EXACTLY in this shape:

> Here's your **animation prompt** — this is the one that brings it to life:
>
> ```
> [the prompt]
> ```
>
> **Now generate it:**
>
> - 🎬 **Platform:** your preferred video generation platform
> - 🤖 **Model:** **Seedance 2.0**
> - 📎 **Attach:** your **9-panel sheet** as the starting / reference frame
> - ⚙️ **Settings:** 10s · 720p · your aspect ratio · audio on
>
> 🎉 That's your paper-cut motion clip!

---

## Step 6 — Done / another

Offer: run another image (back to Step 1), redo a step's prompt, or done.

---

## Guards & notes

- **Never name real public figures or famous artworks** in any prompt — describe them
  generically ("a footballer in a yellow jersey," "a girl reaching for a balloon"). The visual
  still reads correctly.
- Every prompt = one paragraph, no line breaks inside it; the 4 constants are verbatim.
- **Always state the Model explicitly, on its own line:** **GPT Image 2.0** for both image
  steps, **Seedance 2.0** for the video step. Platform stays "your preferred … platform"; the
  Model line is fixed. Keep each brief to: platform → model → (aspect ratio for the sheet) →
  attach → save. Never list a menu of tools or extra attachments.
- This skill runs **no generations** — it only writes prompts and detects what you drop back.
- If the user would rather just **paste a generated image into the chat** instead of saving to
  `reference/`, that's fine too — look at the attached image and continue.
