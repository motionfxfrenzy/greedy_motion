"use client";

import { useState } from "react";
import { getLook, looks, type LookId } from "@videosaas/contracts";

const groups = ["All", ...new Set(looks.map((look) => look.group))];

export function StylePicker({ value, onChange }: { value: LookId; onChange: (look: LookId) => void }) {
  const [group, setGroup] = useState("All");
  const selected = getLook(value);
  const options = looks.filter((look) => look.available && (group === "All" || look.group === group));
  return <div className="style-library">
    <div className="style-library-heading"><b>Visual style</b><span>{selected.name}</span></div>
    <div className="style-filters" aria-label="Filter visual styles">{groups.map((name) => <button type="button" key={name} aria-pressed={group === name} onClick={() => setGroup(name)}>{name}</button>)}</div>
    <div className="style-grid" role="group" aria-label="Visual style">
      {options.map((look) => <button type="button" className="style-choice" aria-pressed={value === look.id} key={look.id} onClick={() => onChange(look.id)}>
        <div className="style-thumbnail">
          {look.preview.kind === "video" ? <video src={look.preview.src} muted playsInline preload="metadata" aria-label={`${look.name} preview`} /> : <img src={look.preview.src} alt={`${look.name}: ${look.preview.label.toLowerCase()}`} loading="lazy" width={480} height={270} />}
          <span className="style-selected" aria-hidden="true">{value === look.id ? "✓" : "+"}</span>
        </div>
        <span className="style-choice-copy"><b>{look.name}</b><small>{look.description}</small><em>{look.renderMode === "native" ? "Drawing treatment" : look.preview.label}</em></span>
      </button>)}
    </div>
    <div className="style-detail" aria-live="polite">
      <b>{selected.name}</b>
      <p>{selected.description} Your brand sets the colors and fonts.</p>
      {selected.renderMode === "generated" && <p>Generate material scenes on the storyboard to produce this style. The initial preview is a layout draft; generation requires a confirmed budget. Real product screenshots and text remain crisp overlays.</p>}
      <details><summary>Style direction &amp; references</summary><p>{selected.instructions.image}</p><p>{selected.instructions.motion}</p>
        {selected.referenceAssets.map((asset) => <a key={asset} href={`/previews/looks/references/${asset}`} target="_blank" rel="noreferrer"><img src={`/previews/looks/references/${asset}`} alt={`${selected.group} source style reference sheet`} loading="lazy" /><span>Open reference image</span></a>)}
      </details>
      {selected.preview.kind === "video" && <video controls muted playsInline preload="metadata" aria-label={`${selected.name} style example`} src={selected.preview.src} />}
      {selected.id === "hairline" && selected.preview.kind !== "video" && <video controls muted playsInline preload="metadata" aria-label="Hairline style example" src="/previews/looks/hairline.mp4" />}
    </div>
  </div>;
}
