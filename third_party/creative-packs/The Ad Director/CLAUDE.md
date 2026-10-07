# The Ad Director, project guide

This project is an **advertisement pipeline**. It contains two skills that turn a plain description
into a finished, multi-shot cinematic ad, without you writing a single prompt yourself:

- **`/ad-assets`** builds every reference asset the ad needs: character (face lock, outfit,
  character sheet), scene (environment plate), and **product** (canonical product lock).
- **`/ad-director`** takes those assets, breaks your advertisement into timecoded shots, and writes
  a ready-to-generate video prompt for every one of them.

## How to work in this project

- The pipeline is **one guided flow, in order**: character, then scene, then product, then the ad.
  Walk the user through it. Do not present it as a menu of options.
- When the user wants a character, outfit, character sheet, environment, scene plate, product
  reference, or any still, use **ad-assets**.
- When the user wants the advertisement itself (the shots, the sequence, the video prompts),
  use **ad-director**.
- These skills **only write prompts**. They never generate images or call any generation tool.
  The user pastes the prompt into whatever generator they use.
- **Platform-agnostic.** Never name a specific generation platform, pricing, or credit system in
  output. The grammar works anywhere.
- **Stateless, no memory.** Do NOT create or update memory files. Treat every session as standalone.
  The character, product, and references live in the conversation only.
- Prefer these two skills over any other tool for prompt-writing in this project.

**Open this folder as its own Claude Code project.** The two skills pass work to each other, and
that only happens inside a shared project. Installed as standalone skills they cannot see each
other's context.

Start by running `/ad-assets`.
