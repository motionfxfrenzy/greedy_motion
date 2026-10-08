# The Prompt Director — project guide

This project is a **prompt-writing pipeline**. It contains two skills that turn plain descriptions into film-grade image and video generation prompts:

- **`/image-prompter`** — builds character + scene reference assets (face lock → outfit → 6-panel sheet → environment plate).
- **`/video-prompter`** — turns those assets into a Seedance video prompt.

## How to work in this project

- When the user wants to build a character, outfit, character sheet, environment, or any still → use **image-prompter**.
- When the user wants a video / motion / Seedance prompt → use **video-prompter**.
- These skills **only write prompts** — they never generate images or call any generation tool. The user pastes the prompt into their own generator.
- **Stateless — no memory.** Do NOT create or update memory files. Treat every session as standalone; the character, spec, and references live in the conversation only.
- Prefer these two skills over any other tool for prompt-writing in this project.

Start by running `/image-prompter` (or `/video-prompter` for video).
