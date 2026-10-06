"use client";

import { useEffect, useRef, useState } from "react";
import { findTheme, themes, type Theme } from "@videosaas/contracts";

type ThemePickerProps = {
  value: string;
  disabled?: boolean;
  onChange: (themeId: string) => void;
};

type Filter = "all" | "light" | "dark";

/** Preview stills are rendered by the worker (npm run themes:previews), so they match real output. */
const previewSrc = (theme: Theme) => `/themes/${theme.id}.jpg`;
const swatches = (theme: Theme) => [theme.tokens.bg, theme.tokens.fg, theme.tokens.brand, theme.tokens.accent, theme.tokens.accent2];

function Swatches({ theme }: { theme: Theme }) {
  return (
    <span className="theme-swatches" aria-hidden="true">
      {swatches(theme).map((color, index) => <span key={index} style={{ background: color }} />)}
    </span>
  );
}

export function ThemePicker({ value, disabled, onChange }: ThemePickerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [pending, setPending] = useState(value);
  const selected = findTheme(value) ?? themes[0];
  const visible = themes.filter((theme) => filter === "all" || theme.mode === filter);

  useEffect(() => setPending(value), [value]);

  const open = () => {
    setPending(value);
    setFilter("all");
    dialogRef.current?.showModal();
    // showModal() focuses the close button; move focus to the current theme so arrow keys start there.
    dialogRef.current?.querySelector<HTMLButtonElement>(`[data-theme-id="${value}"]`)?.focus();
  };
  const close = () => dialogRef.current?.close();
  const choose = (themeId: string) => {
    onChange(themeId);
    close();
  };

  const onGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(event.key in keys)) return;
    event.preventDefault();
    const index = visible.findIndex((theme) => theme.id === pending);
    const next = visible[(index + keys[event.key] + visible.length) % visible.length];
    setPending(next.id);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-theme-id="${next.id}"]`)?.focus();
  };

  return (
    <div className="theme-field">
      <span className="field-label" id="theme-label">Theme</span>
      <button type="button" className="theme-current" onClick={open} disabled={disabled} aria-labelledby="theme-label theme-current-name" aria-haspopup="dialog">
        <img src={previewSrc(selected)} alt="" width={640} height={360} />
        <span className="theme-current-meta">
          <strong id="theme-current-name">{selected.name}</strong>
          <Swatches theme={selected} />
          <span className="theme-change">Browse {themes.length} themes →</span>
        </span>
      </button>

      <dialog ref={dialogRef} className="theme-dialog" aria-labelledby="theme-dialog-title" onClick={(event) => { if (event.target === dialogRef.current) close(); }}>
        <div className="theme-dialog-inner">
          <header className="theme-dialog-header">
            <div>
              <span className="eyebrow">HyperFrames themes</span>
              <h2 id="theme-dialog-title">Choose a look</h2>
              <p>Each preview is a real frame from the renderer. Colors and fonts apply to the whole video.</p>
            </div>
            <button type="button" className="theme-close" onClick={close} aria-label="Close theme gallery">✕</button>
          </header>

          <div className="theme-filters" role="group" aria-label="Filter themes">
            {(["all", "light", "dark"] as const).map((option) => (
              <button key={option} type="button" aria-pressed={filter === option} onClick={() => setFilter(option)}>
                {option === "all" ? `All ${themes.length}` : `${option[0].toUpperCase()}${option.slice(1)} · ${themes.filter((theme) => theme.mode === option).length}`}
              </button>
            ))}
          </div>

          <div className="theme-grid" role="radiogroup" aria-labelledby="theme-dialog-title" onKeyDown={onGridKeyDown}>
            {visible.map((theme) => {
              const checked = theme.id === pending;
              return (
                <button
                  key={theme.id}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  tabIndex={checked || (!visible.some((item) => item.id === pending) && theme === visible[0]) ? 0 : -1}
                  data-theme-id={theme.id}
                  className={`theme-card ${theme.id === value ? "is-current" : ""}`}
                  onClick={() => choose(theme.id)}
                  onFocus={() => setPending(theme.id)}
                >
                  <span className="theme-thumb">
                    <img src={previewSrc(theme)} alt="" loading="lazy" width={640} height={360} />
                    {theme.id === value ? <span className="theme-badge">Selected</span> : null}
                  </span>
                  <span className="theme-card-body">
                    <span className="theme-card-title"><strong>{theme.name}</strong><Swatches theme={theme} /></span>
                    <span className="theme-card-desc">{theme.description}</span>
                    <span className="theme-card-fonts">{theme.tokens.fontDisplay.split(",")[0].replace(/"/g, "")} · {theme.mode}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </dialog>
    </div>
  );
}
