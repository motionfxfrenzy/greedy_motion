# Creative packs: provenance

Raw prompt and skill packs, kept as received (unpacked from the zips that were in `templates/`). **Reference only:
nothing here is read by the product at runtime.** Curated, rewritten parts move into `.claude/skills/` or
`third_party/visual-skills/` and are compiled into the backend; see [Creative library plan](../../docs/CREATIVE_LIBRARY_PLAN.md).

Usage rights: the owner confirmed on 2026-10-07 that every pack here is free to use in the product.

| Folder | Skills inside (`.claude/skills/` unless noted) | Writes | Plan section |
| --- | --- | --- | --- |
| `bs-hyperframes-velocity-sting` | SKILL.md at the folder root | HyperFrames composition | A, formats |
| `bs-hyperframes-chat-to-result-launch` | SKILL.md at the folder root | HyperFrames composition | A, formats |
| `bs-hyperframes-agent-chorus-reel` | SKILL.md at the folder root | HyperFrames composition | A, formats |
| `The Ad Director` | `ad-assets`, `ad-director` | Image and video prompts | B, shot direction |
| `Pink Prompt Director` | `image-prompter`, `video-prompter` | Nano Banana Pro / GPT Image and Seedance prompts | B |
| `Product_Visuals_Claude` | `product-visuals` | Image prompts | B |
| `Studio_Shot_Claude` | `studio-shot` | Image prompts | B |
| `PYNK_AI_UGC_Studio` | `ugc` | Image and video prompts | B, E |
| `Ad-Generator` | `ad-generator` (+ `templates.md`, 40 static ad templates) | Image prompts | B, E |
| `Creative_Formats_Claude` | `paper-animation`, `claymation`, `skeleton-ads`, `song-style-ad`, `talking-object` | Image and video prompts | C, E |
| `motion-design-prompts` | `skills/motion-design`, `.claude/commands/motion-design.md`, 3-step prompts | Image and video prompts | C |
| `Vox Animations` | `vox-animation` (+ `scripts/assemble.sh`) | Prompts, voiceover, ffmpeg assembly | C |
| `claude-creative-skill-library.md` | Index of the nine PYNK-style skills | — | — |

Do not edit files here; change the curated copies instead, so a diff against the original stays possible.
