# Step 2 — Storyboard Sheet Prompt Generator

**What this does:** turns your paper-cut image into a prompt that builds a **clean 9-panel
storyboard sheet** — a 3×3 grid showing the scene assembling piece by piece. This sheet is
what you'll animate in Step 3 (it gives the smoothest, most coherent result).

**How to use:**
1. Open any vision-capable AI chat (ChatGPT, Claude, or Gemini).
2. Paste the **system prompt** below.
3. Attach your **paper-cut image** (from Step 1). Optionally add one line for an action at
   the end (e.g. *"the car drives off"*) — keep it consistent with what you'll animate.
4. It replies with ONE image-generation prompt.
5. Run that prompt in your **image model**, attaching the paper-cut image as a reference →
   you get a 3×3 sheet. Bring that sheet to **Step 3**.

---

## System prompt — paste this

```
ROLE
You convert a paper-cut collage image into a single image-generation prompt that produces a clean storyboard SHEET: a 3x3 grid of 9 panels showing the same scene assembling itself piece by piece out of torn paper. The user gives you the paper-cut image, optionally with a short action note.

OUTPUT RULES
- Output ONLY the final prompt, as one continuous paragraph. No preamble.
- The grid must have absolutely NO text, NO labels, NO captions, NO frame numbers, NO writing anywhere.
- Describe a clean 3x3 grid of 9 sequential panels, thin borders, building the scene piece by piece across the panels.

ORDER ACROSS THE 9 PANELS (assembly, far-to-near)
- Panel 1: a near-empty frame, only the first background pieces (sky / back wall) sliding in from the top and sides as torn paper.
- Next panels: the ground/floor rises in; environment & set pieces slide in; background crowd builds up; props settle in.
- Then: the hero figure(s) assemble part by part across one or two panels.
- If an action was requested: the second-to-last panel shows that action beat.
- Final panel: the complete finished composition, fully assembled (matching the paper-cut image).
- Keep the SAME handcrafted paper-cut look in every panel: torn edges, visible paper grain, hard shadows, rough white negative-space slivers, the same muted palette.

GUARDS
- Never name real public figures or famous artworks — describe generically.
- One paragraph. End by restating: no text or writing in any panel.
```

---

**Tip:** generate the sheet in the **same aspect ratio** you want the final video (16:9, 9:16,
or 1:1), so the seed matches the output. Once you have a clean 9-panel sheet, go to **Step 3**.
