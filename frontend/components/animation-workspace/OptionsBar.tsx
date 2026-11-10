"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motionBlurCopy, motionBlurProblem } from "@videosaas/contracts";
import {
  WORKSPACE_PLAYBACK_RENDER_MODES,
  WORKSPACE_PREVIEW_QUALITIES,
  WORKSPACE_SUBTITLE_MODES,
  WORKSPACE_SUBTITLE_STYLES,
  resolveVisibleOptions
} from "./logic";
import { StatusLine } from "./StatusLine";
import type {
  WorkspaceAudioControlState,
  WorkspaceMotionBlurControlState,
  WorkspaceOptionsConfig,
  WorkspacePreviewQualityControlState,
  WorkspaceStatusBadge,
  WorkspaceSubtitleControlState
} from "./types";

const TEXT_SWATCHES = ["#ffffff", "#fef08a", "#facc15", "#7dd3fc", "#fca5a5", "#231f1b", "#0b0d12"];
const BOX_SWATCHES = ["#0c0f16", "#faf5e8", "#facc15", "#0c2a4a", "#1e293b", "#451a03", "#3b0764"];

type MenuId = "captions" | "style" | "colors" | "opacity" | "position" | "quality";

export interface OptionsBarProps {
  optionsConfig?: WorkspaceOptionsConfig;
  audio?: WorkspaceAudioControlState;
  subtitles?: WorkspaceSubtitleControlState;
  previewQuality?: WorkspacePreviewQualityControlState;
  motionBlur?: WorkspaceMotionBlurControlState;
  statusBadge?: WorkspaceStatusBadge | null;
}

export function OptionsBar({ optionsConfig, audio, subtitles, previewQuality, motionBlur, statusBadge }: OptionsBarProps) {
  const visible = resolveVisibleOptions(optionsConfig);
  const blurControl = motionBlur ?? optionsConfig?.motionBlurControls;
  const [barMode, setBarMode] = useState<"audio" | "subtitles" | null>(
    visible.showSubtitleTab ? "subtitles" : visible.showAudioTab ? "audio" : null
  );
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const headBarRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const triggerRefs = useRef<Partial<Record<MenuId, HTMLButtonElement | null>>>({});

  const closeMenuAndFocus = useCallback((menuId: MenuId) => {
    setOpenMenu(null);
    queueMicrotask(() => {
      triggerRefs.current[menuId]?.focus();
    });
  }, []);

  const positionActivePopover = useCallback(() => {
    const barEl = headBarRef.current;
    const dlgEl = dialogRef.current;
    if (!barEl || !dlgEl) return;
    const wrapEl = dlgEl.closest(".aw-menu-wrap") as HTMLElement | null;
    if (!wrapEl) return;
    const stageEl =
      (barEl.closest(".aw-stage") as HTMLElement | null) ??
      barEl.parentElement ??
      document.documentElement;
    const stageRect = stageEl.getBoundingClientRect();
    const barRect = barEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const minX = Math.max(6, Math.round(stageRect.left));
    const maxX = Math.min(vw - 6, Math.round(stageRect.right));
    const availW = Math.max(160, maxX - minX);
    barEl.style.setProperty("--aw-stage-w", `${availW}px`);

    dlgEl.style.left = "0px";
    dlgEl.style.right = "auto";
    dlgEl.style.top = "calc(100% + 6px)";
    dlgEl.style.bottom = "auto";
    dlgEl.style.transform = "none";
    dlgEl.style.maxWidth = `${Math.min(320, availW)}px`;

    const wrapRect = wrapEl.getBoundingClientRect();
    const dlgRect = dlgEl.getBoundingClientRect();
    const dlgW = dlgRect.width;
    const dlgH = dlgRect.height;

    const rightLimit = Math.min(maxX, Math.max(barRect.right, wrapRect.right));
    if (wrapRect.left >= minX && wrapRect.left + dlgW <= rightLimit) {
      dlgEl.style.left = "0px";
      dlgEl.style.right = "auto";
      dlgEl.dataset.align = "left";
    } else if (wrapRect.right <= maxX && wrapRect.right - dlgW >= minX) {
      dlgEl.style.left = "auto";
      dlgEl.style.right = "0px";
      dlgEl.dataset.align = "right";
    } else {
      const clampedLeft = Math.max(minX, Math.min(wrapRect.left, maxX - dlgW));
      dlgEl.style.left = `${Math.round(clampedLeft - wrapRect.left)}px`;
      dlgEl.style.right = "auto";
      dlgEl.dataset.align = "clamped";
    }

    if (wrapRect.bottom + 8 + dlgH > vh - 8 && wrapRect.top - 8 - dlgH >= 8) {
      dlgEl.style.top = "auto";
      dlgEl.style.bottom = "calc(100% + 6px)";
      dlgEl.dataset.vpos = "up";
    } else {
      dlgEl.style.top = "calc(100% + 6px)";
      dlgEl.style.bottom = "auto";
      dlgEl.dataset.vpos = "down";
    }
  }, []);

  useLayoutEffect(() => {
    if (!openMenu) return;
    positionActivePopover();
    window.addEventListener("resize", positionActivePopover);
    return () => {
      window.removeEventListener("resize", positionActivePopover);
    };
  }, [openMenu, positionActivePopover, previewQuality?.renderMode, previewQuality?.quality]);

  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (headBarRef.current && !headBarRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeMenuAndFocus(openMenu);
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const dlgEl = dialogRef.current;
        if (!dlgEl) return;
        const active = document.activeElement;
        if (active && active instanceof HTMLInputElement) return;
        const opts = Array.from(
          dlgEl.querySelectorAll<HTMLButtonElement>("button.aw-option-row:not(:disabled), button.aw-style-card:not(:disabled)")
        );
        if (opts.length === 0) return;
        e.preventDefault();
        const idx = opts.indexOf(active as HTMLButtonElement);
        const forward = e.key === "ArrowDown" || e.key === "ArrowRight";
        const nextIdx =
          idx === -1
            ? forward
              ? 0
              : opts.length - 1
            : (idx + (forward ? 1 : opts.length - 1)) % opts.length;
        opts[nextIdx]?.focus();
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [openMenu, closeMenuAndFocus]);

  const subMode = subtitles?.mode ?? "full";
  const subStyle = subtitles?.style ?? "pill";
  const subSize = subtitles?.size ?? 100;
  const subOpacity = subtitles?.opacity ?? 100;
  const curScenePos = subtitles?.position ?? { x: 50, y: 80 };
  const current = subtitles?.currentSceneIndex ?? 0;
  const effectiveTextColor = subtitles?.effectiveTextColor ?? "#ffffff";
  const effectiveBgColor = subtitles?.effectiveBgColor ?? "#0c0f16";
  const curModeLabel = WORKSPACE_SUBTITLE_MODES.find((m) => m.id === subMode)?.label ?? "Subtitles";
  const curStyleLabel = WORKSPACE_SUBTITLE_STYLES.find((s) => s.id === subStyle)?.label ?? "Pill";
  const curQuality = previewQuality?.quality ?? 0.4;
  const curQualityLabel = WORKSPACE_PREVIEW_QUALITIES.find((q) => q.id === curQuality)?.label ?? "Standard";
  const curRenderMode = previewQuality?.renderMode;
  const curRenderModeLabel =
    curRenderMode === "draft"
      ? "Draft"
      : curRenderMode === "full"
        ? `Full · ${curQualityLabel}`
        : curQualityLabel;

  const availableSubtitleModes = WORKSPACE_SUBTITLE_MODES.filter((m) => visible.subtitleModes.includes(m.id));

  return (
    <div className="aw-floating-bar" ref={headBarRef} role="toolbar" aria-label="Canvas options">
      <div className="aw-mode-tabs" role="tablist" aria-label="Toolbar mode">
        {visible.showAudioTab && (
          <button
            type="button"
            role="tab"
            aria-selected={barMode === "audio"}
            className={`aw-mode-tab${barMode === "audio" ? " on" : ""}`}
            onClick={() => {
              setBarMode(barMode === "audio" ? null : "audio");
              setOpenMenu(null);
            }}
          >
            <span className="aw-tool-icon">♫</span>
            <span>Audio</span>
          </button>
        )}
        {visible.showSubtitleTab && (
          <button
            type="button"
            role="tab"
            aria-selected={barMode === "subtitles"}
            className={`aw-mode-tab${barMode === "subtitles" ? " on" : ""}`}
            onClick={() => {
              setBarMode(barMode === "subtitles" ? null : "subtitles");
              setOpenMenu(null);
            }}
          >
            <span className="aw-tool-icon">💬</span>
            <span>Subtitle</span>
          </button>
        )}
      </div>

      {barMode === "audio" && visible.showAudioTab && audio && (
        <>
          <i className="aw-bar-sep" />
          <div className="aw-inline-group" role="group" aria-label="Audio tracks">
            {visible.audioTracks.includes("voice") && (
              <button
                type="button"
                className={`aw-track-chip${audio.voice ? " on" : ""}`}
                aria-pressed={audio.voice}
                onClick={audio.onToggleVoice}
                title="Toggle voiceover narration"
              >
                Voice
              </button>
            )}
            {visible.audioTracks.includes("music") && (
              <button
                type="button"
                className={`aw-track-chip${audio.music ? " on" : ""}`}
                aria-pressed={audio.music}
                onClick={audio.onToggleMusic}
                title="Toggle background music"
              >
                Music
              </button>
            )}
            {visible.audioTracks.includes("sfx") && (
              <button
                type="button"
                className={`aw-track-chip${audio.sfx ? " on" : ""}`}
                aria-pressed={audio.sfx}
                onClick={audio.onToggleSfx}
                title="Toggle key-moment sound effects"
              >
                SFX
              </button>
            )}
            {visible.audioTracks.includes("transitions") && (
              <button
                type="button"
                className={`aw-track-chip${audio.transitions ? " on" : ""}`}
                aria-pressed={audio.transitions}
                onClick={audio.onToggleTransitions}
                title="Toggle transition whoosh sounds"
              >
                Transitions
              </button>
            )}
          </div>
        </>
      )}

      {barMode === "subtitles" && visible.showSubtitleTab && subtitles && (
        <>
          <i className="aw-bar-sep" />

          {/* 1. Subtitle Mode Dropdown */}
          <div className="aw-menu-wrap">
            <button
              ref={(el) => {
                triggerRefs.current.captions = el;
              }}
              type="button"
              className={`aw-pill-item${openMenu === "captions" ? " active" : ""}`}
              aria-haspopup="dialog"
              aria-expanded={openMenu === "captions"}
              title={`Subtitle mode: ${subMode === "none" ? "Off" : curModeLabel}`}
              onClick={() => setOpenMenu(openMenu === "captions" ? null : "captions")}
            >
              <span>{subMode === "none" ? "Off" : curModeLabel}</span>
              <span className="aw-caret">▾</span>
            </button>
            {openMenu === "captions" && (
              <div ref={dialogRef} className="aw-dialog aw-dialog-list" role="dialog" aria-label="Subtitle mode">
                <div className="aw-dialog-head">
                  <b>Subtitle Mode</b>
                  <span>Choose how captions appear on screen</span>
                </div>
                <div className="aw-dialog-group" role="radiogroup" aria-label="Subtitle mode">
                  {availableSubtitleModes.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      role="radio"
                      aria-checked={subMode === m.id}
                      className={`aw-option-row${subMode === m.id ? " on" : ""}`}
                      onClick={() => {
                        subtitles.onSelectMode(m.id);
                        closeMenuAndFocus("captions");
                      }}
                    >
                      <div>
                        <b>{m.label}</b>
                        <small>{m.description}</small>
                      </div>
                      {subMode === m.id && <span className="aw-check">✓</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {subMode !== "none" && (
            <>
              {/* 2. Visual Style Picker */}
              {visible.subtitleStyle && (
                <>
                  <i className="aw-bar-sep" />
                  <div className="aw-menu-wrap">
                    <button
                      ref={(el) => {
                        triggerRefs.current.style = el;
                      }}
                      type="button"
                      className={`aw-pill-item${openMenu === "style" ? " active" : ""}`}
                      aria-haspopup="dialog"
                      aria-expanded={openMenu === "style"}
                      title={`Subtitle style: ${curStyleLabel}`}
                      onClick={() => setOpenMenu(openMenu === "style" ? null : "style")}
                    >
                      <span>{curStyleLabel}</span>
                      <span className="aw-caret">▾</span>
                    </button>
                    {openMenu === "style" && (
                      <div ref={dialogRef} className="aw-dialog aw-dialog-styles" role="dialog" aria-label="Subtitle style">
                        <div className="aw-dialog-head">
                          <b>Subtitle Style</b>
                          <span>Pick a look for your captions</span>
                        </div>
                        <div className="aw-style-grid" role="radiogroup" aria-label="Subtitle style">
                          {WORKSPACE_SUBTITLE_STYLES.map((st) => (
                            <button
                              key={st.id}
                              type="button"
                              role="radio"
                              aria-checked={subStyle === st.id}
                              className={`aw-style-card aw-style-preview-${st.id}${subStyle === st.id ? " on" : ""}`}
                              onClick={() => {
                                subtitles.onSelectStyle(st.id);
                                closeMenuAndFocus("style");
                              }}
                            >
                              <span className="aw-style-sample">Sample</span>
                              <small>{st.label}</small>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* 3. Minimal Font Size Stepper */}
              {visible.subtitleSize && (
                <>
                  <i className="aw-bar-sep" />
                  <div className="aw-inline-stepper" role="group" aria-label="Subtitle font size">
                    <button
                      type="button"
                      onClick={() => subtitles.onStepSize(-10)}
                      disabled={subSize <= 50}
                      aria-label="Decrease font size"
                      title="Decrease font size"
                    >
                      −
                    </button>
                    <span title="Font size scale">{subSize}</span>
                    <button
                      type="button"
                      onClick={() => subtitles.onStepSize(10)}
                      disabled={subSize >= 160}
                      aria-label="Increase font size"
                      title="Increase font size"
                    >
                      +
                    </button>
                  </div>
                </>
              )}

              {/* 4. Canva-style Dual Color Circles */}
              {visible.subtitleColors && (
                <>
                  <i className="aw-bar-sep" />
                  <div className="aw-menu-wrap">
                    <button
                      ref={(el) => {
                        triggerRefs.current.colors = el;
                      }}
                      type="button"
                      className={`aw-pill-item aw-pill-swatches${openMenu === "colors" ? " active" : ""}`}
                      aria-haspopup="dialog"
                      aria-expanded={openMenu === "colors"}
                      aria-label="Subtitle colors"
                      title="Text &amp; Box colors"
                      onClick={() => setOpenMenu(openMenu === "colors" ? null : "colors")}
                    >
                      <i className="aw-circle-swatch" style={{ background: effectiveTextColor }} />
                      <i className="aw-circle-swatch" style={{ background: effectiveBgColor }} />
                    </button>
                    {openMenu === "colors" && (
                      <div ref={dialogRef} className="aw-dialog aw-dialog-colors" role="dialog" aria-label="Colors">
                        <div className="aw-dialog-head">
                          <b>Subtitle Colors</b>
                          <span>Text and box colors</span>
                        </div>
                        <div className="aw-dialog-section">
                          <div className="aw-sec-label">
                            <span>Text Color</span>
                            <code>{effectiveTextColor}</code>
                          </div>
                          <div className="aw-swatches">
                            {TEXT_SWATCHES.map((hex) => (
                              <button
                                key={hex}
                                type="button"
                                className={`aw-swatch${effectiveTextColor.toLowerCase() === hex ? " on" : ""}`}
                                style={{ background: hex }}
                                onClick={() => subtitles.onChangeTextColor(hex)}
                                aria-label={`Text color ${hex}`}
                              />
                            ))}
                            <label className="aw-swatch aw-swatch-custom" title="Custom text color">
                              <span>+</span>
                              <input
                                type="color"
                                value={effectiveTextColor}
                                onChange={(e) => subtitles.onChangeTextColor(e.target.value)}
                              />
                            </label>
                          </div>
                        </div>
                        <div className="aw-dialog-section">
                          <div className="aw-sec-label">
                            <span>Box / Outline Color</span>
                            <code>{effectiveBgColor}</code>
                          </div>
                          <div className="aw-swatches">
                            {BOX_SWATCHES.map((hex) => (
                              <button
                                key={hex}
                                type="button"
                                className={`aw-swatch${effectiveBgColor.toLowerCase() === hex ? " on" : ""}`}
                                style={{ background: hex }}
                                onClick={() => subtitles.onChangeBgColor(hex)}
                                aria-label={`Box color ${hex}`}
                              />
                            ))}
                            <label className="aw-swatch aw-swatch-custom" title="Custom box color">
                              <span>+</span>
                              <input
                                type="color"
                                value={effectiveBgColor}
                                onChange={(e) => subtitles.onChangeBgColor(e.target.value)}
                              />
                            </label>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* 5. Canva-style Checkerboard Transparency Button */}
              {visible.subtitleOpacity && (
                <>
                  <i className="aw-bar-sep" />
                  <div className="aw-menu-wrap">
                    <button
                      ref={(el) => {
                        triggerRefs.current.opacity = el;
                      }}
                      type="button"
                      className={`aw-pill-item aw-pill-icon${openMenu === "opacity" ? " active" : ""}`}
                      aria-haspopup="dialog"
                      aria-expanded={openMenu === "opacity"}
                      aria-label="Transparency"
                      title={`Subtitle transparency (${subOpacity}%)`}
                      onClick={() => setOpenMenu(openMenu === "opacity" ? null : "opacity")}
                    >
                      <span className="aw-checker-icon" aria-hidden="true" />
                    </button>
                    {openMenu === "opacity" && (
                      <div ref={dialogRef} className="aw-dialog aw-dialog-opacity" role="dialog" aria-label="Transparency">
                        <div className="aw-sec-label">
                          <span>Transparency</span>
                          <b>{subOpacity}%</b>
                        </div>
                        <input
                          type="range"
                          className="aw-range"
                          min={20}
                          max={100}
                          step={5}
                          value={subOpacity}
                          onChange={(e) => subtitles.onChangeOpacity(Number(e.target.value))}
                          aria-label="Subtitle opacity"
                        />
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* 6. Subtitle Position Dropdown (for current Scene) */}
              {visible.subtitlePosition && (
                <>
                  <i className="aw-bar-sep" />
                  <div className="aw-menu-wrap">
                    <button
                      ref={(el) => {
                        triggerRefs.current.position = el;
                      }}
                      type="button"
                      className={`aw-pill-item aw-pill-secondary${openMenu === "position" ? " active" : ""}`}
                      aria-haspopup="dialog"
                      aria-expanded={openMenu === "position"}
                      title={`Subtitle position (Scene ${current + 1})`}
                      onClick={() => setOpenMenu(openMenu === "position" ? null : "position")}
                    >
                      <span className="aw-pill-glyph" aria-hidden="true">⌖</span>
                      <span className="aw-pill-label">Position</span>
                      <span className="aw-caret">▾</span>
                    </button>
                    {openMenu === "position" && (
                      <div
                        ref={dialogRef}
                        className="aw-dialog aw-dialog-pos"
                        role="dialog"
                        aria-label={`Scene ${current + 1} subtitle position`}
                      >
                        <div className="aw-dialog-head">
                          <b>Subtitle Position · Scene {current + 1}</b>
                          <span>Align Scene {current + 1}&apos;s subtitle or drag it on the video</span>
                        </div>
                        <div className="aw-dialog-section">
                          <div className="aw-sec-label">
                            <span>Align (Scene {current + 1})</span>
                          </div>
                          <div className="aw-pos-grid">
                            <button
                              type="button"
                              className={Math.abs(curScenePos.y - 16) <= 6 ? "on" : ""}
                              onClick={() => subtitles.onChangeScenePosition(current, { x: curScenePos.x, y: 16 })}
                            >
                              ⬆ Top
                            </button>
                            <button
                              type="button"
                              className={Math.abs(curScenePos.y - 50) <= 6 ? "on" : ""}
                              onClick={() => subtitles.onChangeScenePosition(current, { x: curScenePos.x, y: 50 })}
                            >
                              ↕ Middle
                            </button>
                            <button
                              type="button"
                              className={Math.abs(curScenePos.y - 80) <= 6 ? "on" : ""}
                              onClick={() => subtitles.onChangeScenePosition(current, { x: curScenePos.x, y: 80 })}
                            >
                              ⬇ Bottom
                            </button>
                            <button
                              type="button"
                              className={Math.abs(curScenePos.x - 24) <= 6 ? "on" : ""}
                              onClick={() => subtitles.onChangeScenePosition(current, { x: 24, y: curScenePos.y })}
                            >
                              ⬅ Left
                            </button>
                            <button
                              type="button"
                              className={Math.abs(curScenePos.x - 50) <= 6 ? "on" : ""}
                              onClick={() => subtitles.onChangeScenePosition(current, { x: 50, y: curScenePos.y })}
                            >
                              ↔ Center
                            </button>
                            <button
                              type="button"
                              className={Math.abs(curScenePos.x - 76) <= 6 ? "on" : ""}
                              onClick={() => subtitles.onChangeScenePosition(current, { x: 76, y: curScenePos.y })}
                            >
                              ➡ Right
                            </button>
                          </div>
                        </div>
                        <div className="aw-dialog-section">
                          <div className="aw-sec-label">
                            <span>Vertical offset (Y)</span>
                            <b>{Math.round(curScenePos.y)}%</b>
                          </div>
                          <input
                            type="range"
                            className="aw-range"
                            min={8}
                            max={92}
                            step={1}
                            value={Math.round(curScenePos.y)}
                            onChange={(e) =>
                              subtitles.onChangeScenePosition(current, { x: curScenePos.x, y: Number(e.target.value) })
                            }
                          />
                        </div>
                        <div className="aw-dialog-foot">
                          <button
                            type="button"
                            className="aw-foot-btn"
                            onClick={() => subtitles.onApplyPositionToAll(curScenePos)}
                          >
                            Apply to all scenes
                          </button>
                          <button type="button" className="aw-foot-btn" onClick={subtitles.onResetCustomization}>
                            Reset all
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}

      {visible.previewQuality && previewQuality && (
        <>
          <i className="aw-bar-sep" />
          <div className="aw-menu-wrap aw-menu-wrap-quality">
            <button
              ref={(el) => {
                triggerRefs.current.quality = el;
              }}
              type="button"
              className={`aw-pill-item${openMenu === "quality" ? " active" : ""}`}
              aria-haspopup="dialog"
              aria-expanded={openMenu === "quality"}
              aria-label="Preview quality"
              data-render-mode={curRenderMode ?? "full"}
              title={`Preview quality: ${curRenderModeLabel}`}
              onClick={() => setOpenMenu(openMenu === "quality" ? null : "quality")}
            >
              <span>{curRenderModeLabel}</span>
              <span className="aw-caret">▾</span>
            </button>
            {openMenu === "quality" && (
              <div
                ref={dialogRef}
                className="aw-dialog aw-dialog-list aw-dialog-quality"
                role="dialog"
                aria-label="Preview quality"
              >
                {previewQuality.onSelectRenderMode && (
                  <>
                    <div className="aw-dialog-head">
                      <b>Playback quality</b>
                      <span>Draft plays immediately; Full draws every detail</span>
                    </div>
                    <div className="aw-dialog-group" role="radiogroup" aria-label="Playback quality">
                      {WORKSPACE_PLAYBACK_RENDER_MODES.map((m) => {
                        const isSelected = (curRenderMode ?? "draft") === m.id;
                        return (
                          <button
                            key={m.id}
                            type="button"
                            role="radio"
                            aria-checked={isSelected}
                            data-playback-mode={m.id}
                            className={`aw-option-row${isSelected ? " on" : ""}`}
                            onClick={() => {
                              previewQuality.onSelectRenderMode?.(m.id);
                              closeMenuAndFocus("quality");
                            }}
                          >
                            <div>
                              <b>{m.label}{m.id === "draft" ? " (Default)" : ""}</b>
                              <small>{m.description}</small>
                            </div>
                            {isSelected && <span className="aw-check">✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
                {(!previewQuality.onSelectRenderMode || curRenderMode === "full") && (
                  <>
                    <div className="aw-dialog-head">
                      <b>{previewQuality.onSelectRenderMode ? "Stored frame quality (Full)" : "Preview quality"}</b>
                      <span>Stored frame quality in this browser</span>
                    </div>
                    <div className="aw-dialog-group" role="radiogroup" aria-label="Stored frame quality">
                      {WORKSPACE_PREVIEW_QUALITIES.map((q) => (
                        <button
                          key={q.id}
                          type="button"
                          role="radio"
                          aria-checked={curQuality === q.id}
                          className={`aw-option-row${curQuality === q.id ? " on" : ""}`}
                          onClick={() => {
                            previewQuality.onSelectQuality(q.id);
                            closeMenuAndFocus("quality");
                          }}
                        >
                          <div>
                            <b>{q.label}</b>
                            <small>{q.description}</small>
                          </div>
                          {curQuality === q.id && <span className="aw-check">✓</span>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {visible.motionBlur && blurControl && (() => {
        const tooLong = motionBlurProblem(blurControl.durationSeconds);
        const checked = blurControl.enabled && !tooLong;
        const isDisabled = Boolean(blurControl.disabled || tooLong);
        return (
          <>
            <i className="aw-bar-sep" />
            <label
              className={`aw-blur${checked ? " on" : ""}${isDisabled ? " disabled" : ""}`}
              title={tooLong ?? motionBlurCopy.help}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={isDisabled}
                onChange={(event) => blurControl.onToggle(event.target.checked)}
              />
              <span>
                <b>{motionBlurCopy.label}</b>
                <small>{tooLong ?? motionBlurCopy.help}</small>
              </span>
            </label>
          </>
        );
      })()}

      {statusBadge && (
        <>
          <i className="aw-bar-sep" />
          <span className="aw-status-wrap">
            <StatusLine showRetry={statusBadge.showRetry} retryLabel={statusBadge.retryLabel} onRetry={statusBadge.onRetry}>
              {statusBadge.text}
            </StatusLine>
          </span>
        </>
      )}
    </div>
  );
}
