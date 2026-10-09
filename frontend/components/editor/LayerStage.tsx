"use client";
import { memo } from "react";
import { valueAt } from "../../lib/editor/anim.ts";
import type { Layer } from "../../lib/editor/types.ts";

const DRAWN = new Set(["text", "solid", "shape", "image", "precomp"]);

/** CSS filter from a layer's effect stack. A DOM stand-in for the engine raster in the demo. */
function filterOf(layer: Layer): string | undefined {
  const parts: string[] = [];
  for (const fx of [...layer.effects].reverse()) {
    if (!fx.on) continue;
    const p = (i: number) => fx.params[i]?.v ?? 0;
    if (fx.name === "Gaussian blur") parts.push(`blur(${p(0)}px)`);
    else if (fx.name === "Drop shadow") parts.push(`drop-shadow(0 ${p(0)}px ${p(1) / 2}px rgba(4,69,144,${p(2) / 100}))`);
    else if (fx.name === "Glow") parts.push(`drop-shadow(0 0 ${p(0)}px rgba(22,139,255,${Math.min(1, p(1) / 2)}))`);
  }
  return parts.length ? parts.join(" ") : undefined;
}

function LayerView({ layer, t }: { layer: Layer; t: number }) {
  const pos = valueAt(layer, "pos", t) as number[];
  const scale = valueAt(layer, "scale", t) as number[];
  const rot = valueAt(layer, "rot", t) as number;
  const ry = valueAt(layer, "ry", t) as number;
  const opacity = valueAt(layer, "opacity", t) as number;
  const style: React.CSSProperties = {
    left: pos[0]! - layer.w / 2, top: pos[1]! - layer.h / 2, width: layer.w, height: layer.h, opacity: opacity / 100,
    transform: `${layer.threeD ? `perspective(1800px) rotateY(${ry}deg) ` : ""}rotate(${rot}deg) scale(${scale[0]! / 100}, ${scale[1]! / 100})`,
    filter: filterOf(layer)
  };
  if (layer.type === "text") return <div className="ed-ls-l text" style={{ ...style, color: layer.fill, fontFamily: `"${layer.font}", serif`, fontSize: layer.size }}>{layer.text}</div>;
  if (layer.type === "solid") return <div className="ed-ls-l" style={{ ...style, background: layer.color }} />;
  if (layer.type === "shape") return <div className="ed-ls-l" style={{ ...style, background: layer.color, borderRadius: 24 }} />;
  return <div className="ed-ls-l img" style={{ ...style, backgroundImage: layer.img ? `url(${layer.img})` : undefined }} />;
}

/** Draws the composition's visible layers at time `t` (the demo's stand-in for the engine frame). */
export const LayerStage = memo(function LayerStage({ layers, t }: { layers: Layer[]; t: number }) {
  const hasSolo = layers.some((l) => l.solo);
  return (
    <div className="ed-ls">
      {[...layers].reverse().map((l) => (DRAWN.has(l.type) && l.vis && (!hasSolo || l.solo) && t >= l.inP - 1e-6 && t < l.outP ? <LayerView key={l.id} layer={l} t={t} /> : null))}
    </div>
  );
});
