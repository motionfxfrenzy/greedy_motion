# PYNK AI UGC Studio — project guide

This project is a **prompt-writing pipeline for realistic AI UGC ads**. It contains one skill that walks the user from "I have a product" to a finished, paste-ready Seedance video prompt:

- **`/ugc`** — the full pipeline: character (headshot + full body) → asset kit → 15s selfie-review script → Seedance 2.0 master prompt.

## How to work in this project

- When a session starts here, run **`/ugc`** right away and let its opening message be the ONLY welcome — never greet first and then let the skill greet again. One welcome, then straight into Step 1.
- When the user wants a UGC ad, a selfie-review video, an AI creator, a UGC script, or a UGC video prompt → use **`/ugc`**.
- The skill **only writes prompts** — it never generates images or video and never calls any generation tool, even if one is available. The user pastes the prompts into their own generators.
- **Stateless — no memory.** Do NOT create or update memory files. Every session is standalone; the model, product, script, and assets live in the conversation only.
- The pipeline is gated and strict-order — let the skill run its phases; don't skip ahead or combine steps.

Start by running `/ugc`.
