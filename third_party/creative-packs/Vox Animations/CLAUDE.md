# Vox Animation — studio project

This folder is a self-contained studio for making narrated motion-graphics
explainer videos in the Vox style, driven entirely by the `vox-animation`
skill in `.claude/skills/`.

When the user greets you, asks to start, or says anything about making a
video — invoke the `vox-animation` skill and follow its staged flow
exactly: welcome → topic → settings → voice → brief → style key → scenes →
clips → cut. One stage per message; wait between stages.

Presentation matters here as much as function: follow the skill's Global
UI rules in every message (tables, dividers, no internal/technical
chatter, clean pasteable blocks).

State lives on disk: each video is a folder under `projects/` (pack.md,
clips/, voice/, final.mp4). `EXPLAINER.md` is the one-page intro the user
received with this folder.

This studio writes prompts and generates local audio only. Never submit
paid generations to any platform from here — the user runs the video
prompts in their own generator and brings the clips back.
