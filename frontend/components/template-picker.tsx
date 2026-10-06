"use client";

import { useRef } from "react";
import { findTemplate, findTheme, templates, type Template } from "@videosaas/contracts";

type TemplatePickerProps = {
  value: string;
  disabled?: boolean;
  /** Called with the chosen template; the caller decides what to prefill (prompt, theme). */
  onChoose: (template: Template) => void;
};

/** Stills are rendered by the worker (npm run previews), so they match real output. */
export const templatePreview = (template: Template) => `/templates/${template.id}.jpg`;
export const templateScenes = (template: Template) => `/templates/${template.id}-scenes.jpg`;

export function TemplatePicker({ value, disabled, onChoose }: TemplatePickerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const selected = findTemplate(value) ?? templates[0];

  const open = () => {
    dialogRef.current?.showModal();
    dialogRef.current?.querySelector<HTMLButtonElement>(`[data-template-id="${value}"]`)?.focus();
  };
  const close = () => dialogRef.current?.close();

  return (
    <div className="template-field">
      <span className="field-label" id="template-label">Template</span>
      <button type="button" className="theme-current" onClick={open} disabled={disabled} aria-labelledby="template-label template-current-name" aria-haspopup="dialog">
        <img src={templatePreview(selected)} alt="" width={640} height={360} />
        <span className="theme-current-meta">
          <strong id="template-current-name">{selected.name}</strong>
          <span className="template-meta">{selected.durationSeconds} sec · {selected.scenes.length} scenes</span>
          <span className="theme-change">Browse {templates.length} templates →</span>
        </span>
      </button>

      <dialog ref={dialogRef} className="theme-dialog" aria-labelledby="template-dialog-title" onClick={(event) => { if (event.target === dialogRef.current) close(); }}>
        <div className="theme-dialog-inner">
          <header className="theme-dialog-header">
            <div>
              <span className="eyebrow">Starter templates</span>
              <h2 id="template-dialog-title">Start from a template</h2>
              <p>Pick a structure, describe your product, and Claude writes the copy for every scene. You can change the theme and every line afterwards.</p>
            </div>
            <button type="button" className="theme-close" onClick={close} aria-label="Close template gallery">✕</button>
          </header>

          <div className="template-list">
            {templates.map((template) => {
              const current = template.id === value;
              return (
                <article key={template.id} className={`template-card ${current ? "is-current" : ""}`}>
                  <div className="template-media">
                    <img src={templatePreview(template)} alt="" loading="lazy" width={640} height={360} />
                    {current ? <span className="theme-badge">Selected</span> : null}
                  </div>
                  <div className="template-body">
                    <div className="template-head">
                      <h3>{template.name}</h3>
                      <span className="template-meta">{template.durationSeconds} sec · {findTheme(template.defaultTheme)?.name ?? template.defaultTheme} theme</span>
                    </div>
                    <p className="template-best">{template.bestFor}</p>
                    <p className="theme-card-desc">{template.description}</p>
                    <img className="template-strip" src={templateScenes(template)} alt="" loading="lazy" width={1920} height={216} />
                    <ol className="template-scenes" aria-label={`${template.name} scenes`}>
                      {template.scenes.map((scene) => <li key={scene.id}><span>{scene.label}</span><span>{scene.duration}s</span></li>)}
                    </ol>
                    <button type="button" className="template-use" data-template-id={template.id} onClick={() => { onChoose(template); close(); }}>
                      {current ? "Keep this template" : "Use this template"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </dialog>
    </div>
  );
}
