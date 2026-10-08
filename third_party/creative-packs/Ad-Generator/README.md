# Ad Generator

A Claude skill that turns any brand into premium static-ad prompts — 40 battle-tested ad templates, filled with the brand's real colors, voice, and product facts.

You get back a finished image-generation prompt. Attach one photo of your product in your image tool (GPT Image works best), paste the prompt, generate. That's the whole workflow — no API keys, no installs, no dependencies.

## How to use

1. **Open this folder in Claude** (use it as your project / working folder).
2. In the chat, type: **`/ad-generator`**
3. First time: give it your brand's website URL (or say "manual"). It builds your brand profile itself in about two minutes.
4. Pick your templates by number, review the pre-filled campaign brief, say **go**.
5. Copy the prompt(s) into your image tool with ONE clean product photo attached — and generate.

Your brand profile is saved in `brands/`, so every run after the first goes straight to the template menu. Delivered prompts are saved in `brands/[your-brand]/ad-prompts/` for reuse.

That's it — the `/ad-generator` command is already wired into this folder (in `.claude/skills/`), so it just works once the folder is open in Claude.
