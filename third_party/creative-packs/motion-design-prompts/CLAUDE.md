# Motion Design — Paper-Cut (Prompt Mode, standalone)

Drop one image → get the prompts to make a handcrafted **stop-motion paper-collage** video in
**any image/video tools you already use**. **No Higgsfield, no credits** — this skill writes
the prompts; you run the generations wherever you like.

## How to use

Run `/motion-design` in Claude Code, then:
1. Name the project and drop your image into `<project>/reference/`.
2. It hands you the **paper-cut prompt** → you generate the paper-cut image in your image tool
   and drop it back.
3. It hands you the **9-panel sheet prompt** → you generate the sheet and drop it back.
4. It hands you the **animation prompt** → you run it in your video tool with the sheet attached.

It looks at each image you drop and writes the next prompt for you. Three prompts, one flow.

## Prerequisite

Just Claude Code. **No Higgsfield CLI needed.** You bring your own image model (ChatGPT image,
Gemini / Nano Banana, Midjourney…) and video model (Seedance, Kling, Veo, Sora, Hailuo…).

## What's in the package

| Path | Role |
|------|------|
| `skills/motion-design/SKILL.md` | The guided skill (writes the 3 prompts, detects your drops) |
| `.claude/commands/motion-design.md` | Slash-command shim |
| `style-reference/paper-cut-style.jpg` | Bundled style anchor — attach it in the paper-cut step for a closer match |
| `prompts/` | The same prompts as standalone files (for people with no Claude Code — paste `prompts/START-HERE.md` into any AI chat) |

## Note

This skill never runs a generation — it only reads images and writes prompts, so it costs
nothing and works with whatever tools you have.
