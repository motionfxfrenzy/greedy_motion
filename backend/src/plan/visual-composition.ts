import type { VideoProject } from "@videosaas/contracts";
import type { PlanTiming } from "./timing.ts";
import { currentClips } from "./visual-state.ts";
const attr = (s: string) => s.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
export function visualVariables(project: VideoProject) {
  return Object.fromEntries(Object.keys(currentClips(project)).map(id => [`visual.${id}`, true]));
}
/** Static timed media: HyperFrames owns decoding/seeking; preview and export use this exact builder. */
export function withVisuals(html: string, project: VideoProject, timing: PlanTiming, url: (file: string) => string) {
  const clips = currentClips(project);
  const tags = timing.beats.flatMap(t => {
    const clip = clips[t.id]; if (!clip) return [];
    const duration = t.end - t.start, rate = Math.min(1, (clip.duration ?? 8) / duration);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("Material scene timing must be positive.");
    return [`<video id="visual-${attr(t.id)}" src="${attr(url(clip.file))}" muted playsinline preload="auto" data-start="${t.start}" data-duration="${duration}" data-media-start="0" data-playback-rate="${rate}" data-volume="0" data-track-index="0" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;visibility:hidden" aria-label="Generated material scene"></video>`];
  }).join("");
  return html.replace(/(<div id="root"[^>]*>)/, (_, root) => root + tags);
}
