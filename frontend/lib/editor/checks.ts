import { valueAt } from "./anim.ts";
import { ACTION_SAFE, layerBox, safeRect } from "./geometry.ts";
import { formatTime, round3 } from "./time.ts";
import type { Canvas, CheckIssue, Clip, Layer } from "./types.ts";

const byLevel = (a: CheckIssue, b: CheckIssue) => (a.lvl === "error" ? 0 : 1) - (b.lvl === "error" ? 0 : 1);
const cssValue = (clip: Clip, key: string) => clip.css.find((row) => row[0] === key)?.[1];

/** Composition checks for Layers mode. Errors block a full render; warnings do not. */
export function checkLayers(layers: readonly Layer[], duration: number, canvas: Canvas, playhead: number): CheckIssue[] {
  const out: CheckIssue[] = [];
  const safe = safeRect(canvas, ACTION_SAFE);
  for (const layer of layers) {
    if (layer.outP > duration + 1e-3) out.push({ lvl: "error", id: layer.id, msg: `${layer.name} ends at ${formatTime(layer.outP)}, after the composition (${formatTime(duration)}).`, hint: "Trim its out point.", t: layer.inP });
    if (layer.type === "text" && !String(layer.text ?? "").trim()) out.push({ lvl: "error", id: layer.id, msg: `${layer.name} has no text.`, hint: "Type some text or delete the layer.", t: layer.inP });
    if (!["text", "shape", "image", "precomp"].includes(layer.type) || !layer.vis) continue;
    const at = Math.max(layer.inP, Math.min(playhead, layer.outP - 0.05));
    const box = layerBox(layer, at);
    if (box.cx - box.w / 2 < safe.x || box.cx + box.w / 2 > safe.x + safe.w || box.cy - box.h / 2 < safe.y || box.cy + box.h / 2 > safe.y + safe.h)
      out.push({ lvl: "warning", id: layer.id, msg: `${layer.name} crosses the action-safe area.`, hint: "Move or scale it inside the dashed frame.", t: at });
    const scale = (valueAt(layer, "scale", at) as number[])[0]!;
    if (layer.type === "image" && scale > 150) out.push({ lvl: "warning", id: layer.id, msg: `${layer.name} is scaled to ${Math.round(scale)}% and may look soft.`, hint: "Import a larger file.", t: at });
  }
  return out.sort(byLevel);
}

/** Lint for HTML clips mode. The real HyperFrames lint replaces this once its output format is wired in. */
export function lintClips(clips: readonly Clip[], duration: number, canvas: Canvas): CheckIssue[] {
  const out: CheckIssue[] = [];
  for (const clip of clips) {
    if (clip.start + clip.dur > duration + 1e-3) out.push({ lvl: "error", id: clip.id, msg: `${clip.name} ends at ${round3(clip.start + clip.dur)}s, after the composition ends (${duration}s).`, hint: "Trim it or lower Duration." });
  }
  clips.forEach((a, i) => clips.slice(i + 1).forEach((b) => {
    if (a.track === b.track && a.start < b.start + b.dur && b.start < a.start + a.dur)
      out.push({ lvl: "error", id: b.id, msg: `${a.name} and ${b.name} overlap on Track ${a.track}.`, hint: "Move one clip or put it on another track." });
  }));
  const win = clips.find((c) => c.kind === "box" && c.id === "win");
  for (const clip of clips) {
    if (clip.kind !== "text") continue;
    if (!clip.tweens.length) out.push({ lvl: "warning", id: clip.id, msg: `${clip.name} has no tweens, so it appears with a hard cut.`, hint: "Add an opacity or y tween." });
    const top = Number.parseFloat(cssValue(clip, "top") ?? "") || 0;
    if (win && clip.start < win.start + win.dur && top > canvas.height * 0.28 && top < canvas.height * 0.74)
      out.push({ lvl: "warning", id: clip.id, msg: `${clip.name} sits on top of ${win.name} content.`, hint: "Move it below the list or change its start." });
  }
  return out.sort(byLevel);
}
