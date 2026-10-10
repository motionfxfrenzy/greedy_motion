import { parseProject, readTweens, type SourceClip } from "./html-source.ts";
import type { Canvas, Clip, ClipKind } from "./types.ts";

const kindOf = (c: SourceClip): ClipKind => {
  if (c.tag === "audio") return "audio";
  if (c.tag === "video") return "video";
  if (c.tag === "img") return "img";
  return c.leaf && c.text.trim() ? "text" : "box";
};

export type ClipsModel = { clips: Clip[]; canvas: Canvas; duration: number };

/** The editor's clip list for a composition: timing and CSS from the HTML, tweens from its GSAP script. */
export function readClips(html: string): ClipsModel {
  const project = parseProject(html);
  const clips = project.clips.map((c): Clip => {
    const kind = kindOf(c);
    const tweens = readTweens(html, c.id, c.start).map(({ id: _id, method: _method, ...tween }) => tween);
    return {
      id: c.id,
      name: c.id,
      track: c.track,
      start: c.start,
      dur: c.dur,
      kind,
      text: c.text,
      css: c.css,
      tweens,
      ...(c.src ? { src: c.src } : {}),
      ...(kind === "audio" ? { vol: c.volume ?? 0, mute: c.muted } : {})
    };
  });
  return { clips, canvas: project.canvas, duration: project.duration };
}
