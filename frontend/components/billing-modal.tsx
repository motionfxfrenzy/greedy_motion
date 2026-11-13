"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { PaidTier } from "@videosaas/contracts";
import { cancelSubscription, changePlan, downloadInvoice, getBillingOverview, resumeSubscription } from "../lib/api";
import { closeOverlay, openOverlayOrPage } from "../lib/lemon";
import { cancelConfirmText, cardLine, changeConfirm, describeSubscription, formatDate, invoiceRows, modalStateFor, planChoices, tokenLine, type ModalState } from "./billing-modal-model";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
const message = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

/**
 * Everything about the plan, inside the app: plan, payment method, plan changes, invoices, tokens, cancel and resume.
 * Card details are only typed into Lemon Squeezy's secure form, opened as an overlay with Lemon.js on this page.
 */
export function BillingModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ModalState>({ kind: "loading" });
  const [reason, setReason] = useState("");
  const [overlayOpen, setOverlayOpen] = useState(false);
  const overlayRef = useRef(false);

  // Modal behaviour: focus moves in, Tab stays inside, Escape closes, and focus goes back to the button that opened it.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; opener?.focus?.(); closeOverlay(); };
  }, []);
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (overlayRef.current) return; // Lemon Squeezy's overlay has the keyboard while it is open
    if (event.key === "Escape") { event.stopPropagation(); onClose(); return; }
    if (event.key !== "Tab" || !panel.current) return;
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  const load = () => {
    setState({ kind: "loading" });
    getBillingOverview().then((overview) => setState(modalStateFor(overview)), (error: unknown) => setState({ kind: "error", message: message(error, "Could not reach billing just now.") }));
  };
  useEffect(load, []);

  /** Re-reads the overview after a change, keeping the modal open and saying what happened. */
  const refresh = async (notice: string) => {
    const next = modalStateFor(await getBillingOverview());
    setState(next.kind === "ready" ? { ...next, notice } : next);
    onChanged();
  };

  const act = async (kind: "cancel" | "resume" | "change", target?: PaidTier) => {
    if (state.kind !== "ready") return;
    setState({ ...state, busy: kind });
    try {
      if (kind === "cancel") await cancelSubscription(reason);
      else if (kind === "resume") await resumeSubscription();
      else if (target) await changePlan(target);
      setReason("");
      await refresh(kind === "cancel" ? "Your subscription is cancelled. You can resume it until the period ends." : kind === "resume" ? "Your subscription is back on." : "Your plan is changed.");
    } catch (error) {
      setState({ ...state, busy: null, confirming: kind === "cancel", changing: kind === "change" ? (target ?? null) : null, notice: message(error, "Something went wrong. Try again.") });
    }
  };

  const updateCard = async (url: string) => {
    if (state.kind !== "ready") return;
    setState({ ...state, busy: "update", notice: null });
    try {
      overlayRef.current = true; setOverlayOpen(true);
      const how = await openOverlayOrPage(url, (event) => {
        if (event.event === "PaymentMethodUpdate.Updated") void refresh("Your payment method is updated.").catch(() => undefined);
        if (event.event === "PaymentMethodUpdate.Closed") { overlayRef.current = false; setOverlayOpen(false); setState((current) => (current.kind === "ready" ? { ...current, busy: null } : current)); }
      }, "tab");
      // Lemon.js could not open: card entry is the one step that may leave the app, so its secure page is in a new tab.
      if (how === "page") { overlayRef.current = false; setOverlayOpen(false); setState((current) => (current.kind === "ready" ? { ...current, busy: null, notice: "Lemon Squeezy's secure card page opened in a new tab. Close this window and open Manage billing again when you are done." } : current)); }
    } catch (error) {
      overlayRef.current = false; setOverlayOpen(false);
      setState((current) => (current.kind === "ready" ? { ...current, busy: null, notice: message(error, "Could not open the secure payment window.") } : current));
    }
  };

  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const download = async (id: string) => {
    setDownloading(id); setDownloadError(null);
    try { await downloadInvoice(id); } catch (error) { setDownloadError(message(error, "Could not download that invoice right now.")); }
    setDownloading(null);
  };

  return (
    <div className="billing-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !overlayOpen) onClose(); }}>
      <div ref={panel} className="billing-dialog" role="dialog" aria-modal="true" aria-labelledby="billing-title" onKeyDown={onKeyDown}>
        <div className="theme-dialog-header">
          <div><h2 id="billing-title">Billing</h2></div>
          <button className="theme-close" type="button" aria-label="Close billing" onClick={onClose}>×</button>
        </div>

        {state.kind === "loading" && <p className="profile-note" role="status">Loading your billing…</p>}

        {state.kind === "error" && <div className="billing-section" role="alert">
          <b>We could not load your billing</b>
          <p>{state.message}</p>
          <div className="profile-actions"><button className="secondary-button" onClick={load}>Try again</button></div>
        </div>}

        {state.kind === "none" && <div className="billing-section">
          <b>You are on the Free plan</b>
          <p>There is nothing to manage yet. Pick a plan to get monthly tokens and remove the watermark.</p>
          <div className="profile-actions"><Link className="primary-button" href="/pricing">View plans</Link></div>
        </div>}

        {state.kind === "ready" && (() => {
          const { subscription: sub, invoices, tokens } = state.overview;
          const view = describeSubscription(sub);
          const confirm = state.changing ? changeConfirm(sub.tier, state.changing, sub.interval, sub.renewsAt ?? sub.endsAt, undefined, tokens) : null;
          return <>
            {state.notice && <p className={`profile-note ${/^(Could not|Something|Resume|Choose|That )/.test(state.notice) ? "bad" : "ok"}`} role="status">{state.notice}</p>}

            <section className="billing-section" aria-labelledby="billing-plan">
              <b id="billing-plan">{sub.planName} plan{sub.interval === "year" ? " (Annual)" : ""}</b>
              <p><span className={`billing-status ${view.tone}`}>{view.statusLabel}</span> {view.dateLine}</p>
              {view.prominentUpdate && sub.updatePaymentUrl && <p className="profile-note bad" role="alert">Your last payment failed. <button className="primary-button" disabled={state.busy !== null} onClick={() => void updateCard(sub.updatePaymentUrl!)}>Update payment method</button></p>}
            </section>

            <section className="billing-section" aria-labelledby="billing-card">
              <div className="profile-row">
                <div><b id="billing-card">Payment method</b><p>{cardLine(sub)}</p></div>
                {view.showUpdate && !view.prominentUpdate && sub.updatePaymentUrl && <button className="secondary-button" disabled={state.busy !== null} onClick={() => void updateCard(sub.updatePaymentUrl!)}>{state.busy === "update" ? "Opening…" : "Update payment method"}</button>}
              </div>
            </section>

            {tokens && <section className="billing-section" aria-labelledby="billing-tokens"><b id="billing-tokens">Plan tokens this period</b><p>{tokenLine(tokens)}{tokens.resetsAt ? ` Resets ${formatDate(tokens.resetsAt)}.` : ""}</p></section>}

            <section className="billing-section" aria-labelledby="billing-plans">
              <b id="billing-plans">Change plan</b>
              {sub.cancelAtPeriodEnd && <p>Resume your subscription to change plans.</p>}
              <ul className="billing-plans">
                {planChoices(sub.tier, sub.interval).map((choice) => <li key={choice.tier}>
                  <div><b>{choice.name}</b><p>{choice.priceText}</p></div>
                  {choice.kind === "current" ? <span className="billing-status ok">Current plan</span>
                    : <button className="secondary-button" disabled={state.busy !== null || sub.cancelAtPeriodEnd || !["active", "on_trial"].includes(sub.status)} onClick={() => setState({ ...state, changing: choice.tier, confirming: false, notice: null })}>{choice.kind === "upgrade" ? "Upgrade" : "Downgrade"}</button>}
                </li>)}
              </ul>
              {confirm && state.changing && <div className="billing-confirm" role="group" aria-labelledby="billing-change-title">
                <b id="billing-change-title">{confirm.title}</b>
                {confirm.lines.map((line) => <p key={line}>{line}</p>)}
                <div className="profile-actions">
                  <button className="primary-button" disabled={state.busy !== null} onClick={() => void act("change", state.changing!)}>{state.busy === "change" ? "Changing…" : confirm.confirmLabel}</button>
                  <button className="secondary-button" disabled={state.busy !== null} onClick={() => setState({ ...state, changing: null })}>Keep {sub.planName}</button>
                </div>
              </div>}
            </section>

            <section className="billing-section" aria-labelledby="billing-invoices">
              <b id="billing-invoices">Recent invoices</b>
              {invoices.length === 0 ? <p>No invoices yet.</p> : <table className="billing-invoices"><thead><tr><th scope="col">Date</th><th scope="col">Amount</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Download</span></th></tr></thead>
                <tbody>{invoiceRows(invoices).map((row) => <tr key={row.id}><td>{row.date}</td><td>{row.amount}</td><td>{row.status}</td><td>{row.url ? <button className="text-button" disabled={downloading !== null} onClick={() => void download(row.id)} aria-label={`Download invoice from ${row.date}`}>{downloading === row.id ? "Preparing…" : "Download"}</button> : null}</td></tr>)}</tbody></table>}
              {downloadError && <p className="profile-note bad" role="alert">{downloadError}</p>}
            </section>

            {view.canResume && <section className="billing-section">
              <div className="profile-row">
                <div><b>Cancels on {formatDate(sub.endsAt)}</b><p>You keep your plan and remaining tokens until then.</p></div>
                <button className="primary-button" disabled={state.busy !== null} onClick={() => void act("resume")}>{state.busy === "resume" ? "Resuming…" : "Resume subscription"}</button>
              </div>
            </section>}

            {view.canCancel && !state.confirming && <section className="billing-section">
              <div className="profile-row">
                <div><b>Cancel subscription</b><p>Stop future charges. Your plan stays until the end of the period.</p></div>
                <button className="secondary-button billing-danger" onClick={() => setState({ ...state, confirming: true, changing: null, notice: null })}>Cancel subscription</button>
              </div>
            </section>}

            {view.canCancel && state.confirming && <section className="billing-section billing-confirm" role="group" aria-labelledby="billing-confirm-title">
              <b id="billing-confirm-title">Cancel your subscription?</b>
              <p>{cancelConfirmText(sub)}</p>
              <label>Why are you cancelling? (optional)<input value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} autoComplete="off" /></label>
              <div className="profile-actions">
                <button className="secondary-button billing-danger" disabled={state.busy !== null} onClick={() => void act("cancel")}>{state.busy === "cancel" ? "Cancelling…" : "Cancel subscription"}</button>
                <button className="primary-button" disabled={state.busy !== null} onClick={() => setState({ ...state, confirming: false })}>Keep plan</button>
              </div>
            </section>}
          </>;
        })()}
      </div>
    </div>
  );
}
