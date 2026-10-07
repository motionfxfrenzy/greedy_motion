# 🎬 Paper-Cut Motion — Prompt Pack

Turn **any image** into a handcrafted **stop-motion paper-collage** video — where the whole
scene builds itself out of torn paper. This pack works with **any AI tools you already use**.
No special software, no setup.

You just copy two prompts and run them. Here's the whole flow.

---

## What you need

- **A vision AI chat** to run the two prompts — **ChatGPT**, **Claude**, or **Gemini** (any
  one that lets you attach an image).
- **An image model** to make the paper-cut picture — **ChatGPT (image)**, **Google Gemini /
  Nano Banana**, **Midjourney**, or similar.
- **A video model** to animate it — **Seedance**, **Kling**, **Veo**, **Sora**, **Hailuo**,
  or **Higgsfield** (any image-to-video tool).

*(Use whichever you have — the prompts are written to work anywhere.)*

---

## The flow — 3 prompts, 3 hops

> **Easiest way:** open `START-HERE.md` and paste the single **Guide Prompt** — it walks you
> through all of this automatically. The steps below are the same thing done manually.

### 1. Make the paper-cut image
- Open `1-style-prompt.md`, copy the **system prompt** into your AI chat, and **attach your
  image**.
- It gives you a **style prompt**. Run that in your **image model**, attaching your original
  image as a reference. *(If your tool supports a style reference too, also attach
  `style-reference/paper-cut-style.jpg` for a closer match.)*
- → You now have a **paper-cut version** of your image.

### 2. Make the 9-panel sheet
- Open `2-sheet-prompt.md`, paste the **system prompt**, and **attach your paper-cut image**
  (optionally name an action for the end).
- It gives you a **sheet prompt**. Run that in your **image model** with the paper-cut image
  attached, in your target aspect ratio.
- → You now have a **3×3 storyboard sheet** showing the scene assembling piece by piece.
  *(This sheet is the seed — it gives the smoothest, most coherent animation.)*

### 3. Write the animation prompt
- Open `3-animation-prompt.md`, paste the **system prompt**, and **attach your 9-panel
  sheet**. Restate the action if you want one.
- → It gives you the **animation prompt**.

### 4. Animate it
- Run the animation prompt in your **video model**, with the **9-panel sheet attached** as
  the starting/reference frame.
- Recommended settings: **10 seconds**, **720p**, your aspect (16:9 / 9:16 / 1:1), audio on.

### 5. Done
- You've got a stop-motion paper-cut assembly clip. Re-run for variations — these models
  have natural variance, so each render differs.

---

## Tips

- **Better source = better result.** A clean, finished, poster-like image animates far more
  cleanly than a busy or low-quality one.
- **Keep actions simple.** One clear beat at the end works best ("drives off", "lifts away",
  "kicks → scatter"). Complex multi-step actions get messy.
- **Pure assembly is the safe default** — it looks great on its own. Add an action only when
  it adds something.
- **If a render comes out rough,** just run it again — variance is normal. Or simplify the
  action.
- **Content limits:** some tools refuse graphic/violent imagery. If a render fails for no
  clear reason, that's usually why — try a different source image.

---

## The look (what makes it work)

Every prompt locks the same handmade style: **torn paper edges, visible paper grain, hard
shadows, staggered "imperfect" stop-motion timing, and paper-only ASMR sound.** That
consistency is what makes these read as real cut-paper animation rather than generic motion.

Have fun — drop in any image and watch it build itself. 📄✨
