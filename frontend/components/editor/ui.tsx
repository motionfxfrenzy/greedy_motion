"use client";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { hexToRgb, hsvToRgb, normaliseHex, rgbToHex, rgbToHsv, unitIn, type Hsv, type Rgb } from "../../lib/editor/color.ts";
import { startDrag } from "./drag.ts";
import { Icon, type IconName } from "./icons.tsx";

export function IconButton({ icon, label, onClick, active, disabled, size = 14, className = "" }: { icon: IconName; label: string; onClick?: () => void; active?: boolean; disabled?: boolean; size?: number; className?: string }) {
  return (
    <button type="button" className={`ed-ibtn ${active ? "on" : ""} ${className}`} aria-label={label} title={label} aria-pressed={active === undefined ? undefined : active} disabled={disabled} onClick={onClick}>
      <Icon name={icon} size={size} />
    </button>
  );
}

export function Switch({ on, label, onToggle, tone, children }: { on: boolean; label: string; onToggle: () => void; tone?: "solo" | "lock"; children: ReactNode }) {
  return (
    <button type="button" className={`ed-sw ${on ? `on ${tone ?? ""}` : ""}`} aria-label={label} title={label} aria-pressed={on} onClick={(e) => { e.stopPropagation(); onToggle(); }} onPointerDown={(e) => e.stopPropagation()}>
      {children}
    </button>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, badge }: { tabs: { id: T; label: string }[]; value: T; onChange: (id: T) => void; badge?: Partial<Record<T, number>> }) {
  return (
    <div className="ed-tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={value === t.id} className={`ed-tab ${value === t.id ? "on" : ""}`} onClick={() => onChange(t.id)}>
          {t.label}
          {badge?.[t.id] ? <span className="ed-badge">{badge[t.id]}</span> : null}
        </button>
      ))}
    </div>
  );
}

/**
 * A number field whose label is a scrub handle: drag to change (Shift ×10, Alt ×0.1). The whole drag is
 * one history step, wired through onBegin / onChange / onCommit.
 */
export function NumberField({ label, value, step = 1, min, max, onBegin, onChange, onCommit, onCancel, title, disabled, readOnly }: {
  label?: string; value: number; step?: number; min?: number; max?: number; title?: string; disabled?: boolean; readOnly?: boolean;
  onBegin?: () => void; onChange: (v: number) => void; onCommit?: () => void; onCancel?: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const clampValue = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const round = (v: number) => Math.round(v / (step / 10 || 0.01)) * (step / 10 || 0.01);
  const field = useRef<HTMLInputElement>(null);
  const scrub = (e: ReactPointerEvent, onClick?: () => void) => {
    if (disabled || readOnly) return;
    const base = value;
    e.preventDefault();
    startDrag(e, {
      onClick,
      onStart: () => onBegin?.(),
      onMove: (dx, _dy, ev) => onChange(clampValue(round(base + dx * step * (ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1)))),
      onEnd: () => onCommit?.(),
      onCancel: () => { onChange(base); onCancel?.(); }
    });
  };
  const commitText = (text: string) => {
    setDraft(null);
    const n = Number.parseFloat(text);
    if (Number.isFinite(n) && n !== value) { onBegin?.(); onChange(clampValue(n)); onCommit?.(); }
  };
  return (
    <label className={`ed-num ${disabled ? "disabled" : ""}`} title={title}>
      {label ? <span className="ed-num-l" onPointerDown={(e) => scrub(e)}>{label}</span> : null}
      <input
        ref={field}
        // Drag across the box to change the value; a plain click still puts the cursor in it to type.
        onPointerDown={(e) => { if (document.activeElement !== e.currentTarget && e.button === 0) scrub(e, () => field.current?.focus()); }}
        value={draft ?? String(Math.round(value * 1000) / 1000)} inputMode="decimal" disabled={disabled} readOnly={readOnly}
        aria-label={title ?? label}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commitText(e.currentTarget.value)}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setDraft(null); e.currentTarget.blur(); } e.stopPropagation(); }}
      />
    </label>
  );
}

export type ColorLive = { begin(): void; update(hex: string): void; commit(): void; cancel(): void };

/**
 * Colour field: a swatch and hex box in the row, and a flyout with the brand kit plus a picker for any colour (saturation / brightness
 * square, hue strip, hex and R G B). Dragging previews live on the canvas and is one undo step; Esc during a drag restores the start.
 * The flyout opens to the left of the field, away from the window's edge.
 */
export function ColorField({ value, brand, onChange, live, label }: { value: string; brand: string[]; onChange: (hex: string) => void; live: ColorLive; label: string }) {
  const [open, setOpen] = useState(false);
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const [popHex, setPopHex] = useState<string | null>(null);
  const [hsv, setHsvState] = useState<Hsv>(() => rgbToHsv(hexToRgb(value)));
  const hsvRef = useRef(hsv);
  const setHsv = (next: Hsv) => { hsvRef.current = next; setHsvState(next); };
  const ref = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  // Follow changes made elsewhere (undo, typing in the row's hex box) without losing the hue of a grey while dragging.
  useEffect(() => { if (rgbToHex(hsvToRgb(hsvRef.current)) !== value.toUpperCase()) setHsv(rgbToHsv(hexToRgb(value))); }, [value]);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { const t = e.target; if (t instanceof Node && !ref.current?.contains(t) && !pop.current?.contains(t)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.body.classList.contains("ed-dragging")) { e.stopPropagation(); setOpen(false); } };
    // The flyout is fixed to the window so the inspector's scroll area never clips it; scrolling or resizing closes it.
    const away = () => setOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc, true);
    window.addEventListener("resize", away);
    document.addEventListener("scroll", away, true);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", esc, true); window.removeEventListener("resize", away); document.removeEventListener("scroll", away, true); };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !ref.current || !pop.current) { setAt(null); return; }
    const anchor = ref.current.getBoundingClientRect();
    const box = pop.current.getBoundingClientRect();
    const gap = 14;
    const room = anchor.left - box.width - gap;
    const left = room >= 8 ? room : Math.max(8, Math.min(anchor.right - box.width, window.innerWidth - box.width - 8));
    setAt({ left, top: Math.max(8, Math.min(anchor.top - 8, window.innerHeight - box.height - 8)) });
  }, [open]);

  const hex = rgbToHex(hsvToRgb(hsv));
  const rgb = hsvToRgb(hsv);
  const emit = (next: Hsv) => { setHsv(next); live.update(rgbToHex(hsvToRgb(next))); };
  const once = (text: string) => { const v = normaliseHex(text); if (!v || v === value.toUpperCase()) return; onChange(v); setHsv(rgbToHsv(hexToRgb(v))); };

  // A drag inside the square or the strip: apply on press, follow the pointer (pinned at the edges), one commit at the end.
  const dragIn = (e: ReactPointerEvent, kind: "sv" | "hue") => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    const start = hsvRef.current;
    const apply = (cx: number, cy: number) => {
      const u = unitIn(el.getBoundingClientRect(), cx, cy);
      const cur = hsvRef.current;
      emit(kind === "sv" ? { h: cur.h, s: u.x, v: 1 - u.y } : { h: Math.min(359.99, u.x * 360), s: cur.s, v: cur.v });
    };
    live.begin();
    apply(e.clientX, e.clientY);
    startDrag(e, {
      onMove: (_dx, _dy, ev) => apply(ev.clientX, ev.clientY),
      onEnd: () => live.commit(),
      onClick: () => live.commit(),
      onCancel: () => { live.cancel(); setHsv(start); }
    }, 0);
  };

  const channel = (i: 0 | 1 | 2, v: number) => {
    const c: Rgb = [...rgb];
    c[i] = v;
    const next = rgbToHsv(c);
    const cur = hsvRef.current;
    if (next.s === 0) next.h = cur.h;
    if (next.v === 0) { next.h = cur.h; next.s = cur.s; }
    emit(next);
  };

  const inBrand = brand.some((c) => c.toLowerCase() === value.toLowerCase());
  return (
    <div className="ed-color" ref={ref}>
      <button type="button" className="ed-swatch" aria-label={`${label}: choose a colour`} aria-expanded={open} style={{ background: value }} onClick={() => setOpen((v) => !v)} />
      <input
        className="ed-hex" value={hexDraft ?? value.toUpperCase()} aria-label={`${label} hex`} spellCheck={false} maxLength={7}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => { setHexDraft(e.target.value); once(e.target.value); }}
        onBlur={() => setHexDraft(null)}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setHexDraft(null); e.currentTarget.blur(); } }}
      />
      {open ? (
        <div className="ed-pop" ref={pop} role="dialog" aria-label={`${label} colours`} style={at ? { left: at.left, top: at.top } : { visibility: "hidden" }}>
          <div className="ed-cap">Brand kit</div>
          <div className="ed-swatches">
            {brand.map((c) => <button key={c} type="button" aria-label={c} title={c} className={`ed-swatch-lg ${c.toLowerCase() === value.toLowerCase() ? "on" : ""}`} style={{ background: c }} onClick={() => { onChange(c); setHsv(rgbToHsv(hexToRgb(c))); }} />)}
          </div>
          <div className="ed-cap ed-pop-gap">{inBrand ? "Any colour" : "Custom colour"}</div>
          <div className="ed-sv" role="slider" aria-label="Saturation and brightness" aria-valuetext={hex} style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))` }} onPointerDown={(e) => dragIn(e, "sv")}>
            <i className="ed-sv-dot" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }} />
          </div>
          <div className="ed-hue" role="slider" aria-label="Hue" aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(hsv.h)} onPointerDown={(e) => dragIn(e, "hue")}>
            <i className="ed-hue-dot" style={{ left: `${(hsv.h / 360) * 100}%`, background: `hsl(${hsv.h} 100% 50%)` }} />
          </div>
          <label className="ed-hexrow"><span>HEX</span>
            <input
              value={popHex ?? hex} aria-label={`${label} hex in picker`} spellCheck={false} maxLength={7}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => { setPopHex(e.target.value); once(e.target.value); }}
              onBlur={() => setPopHex(null)}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setPopHex(null); e.currentTarget.blur(); } }}
            />
          </label>
          <div className="ed-rgb">
            {(["R", "G", "B"] as const).map((ch, i) => (
              <NumberField key={ch} label={ch} title={`${label} ${ch === "R" ? "red" : ch === "G" ? "green" : "blue"} (0–255)`} value={rgb[i]!} min={0} max={255} step={1}
                onBegin={() => live.begin()} onChange={(v) => channel(i as 0 | 1 | 2, Math.round(v))} onCommit={() => live.commit()} onCancel={() => live.cancel()} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export const Cap = ({ children }: { children: ReactNode }) => <div className="ed-cap">{children}</div>;

/**
 * Pointer-down on a property's name scrubs that row's number, like dragging the number itself. Rows with two numbers
 * (position, scale) keep their own X / Y handles instead.
 */
export function scrubRowValue(e: ReactPointerEvent) {
  const row = (e.currentTarget as HTMLElement).closest(".ed-prow");
  const fields = row?.querySelectorAll<HTMLInputElement>(".ed-num input");
  if (!fields || fields.length !== 1 || e.button !== 0) return;
  e.preventDefault();
  fields[0]!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY, button: 0, pointerId: e.pointerId, shiftKey: e.shiftKey, altKey: e.altKey }));
}
