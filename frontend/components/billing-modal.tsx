"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BillingError, cancelSubscription, getBillingOverview, resumeSubscription } from "../lib/api";
import { cancelConfirmText, cardLine, describeSubscription, formatDate, invoiceRows, modalStateFor, tokenLine, type ModalState } from "./billing-modal-model";

/** In-app billing: plan, payment method, invoices and tokens, with cancel and resume. Card details are only ever entered on Lemon Squeezy's own page. */
export function BillingModal({ portalUrl, onClose, onChanged }: { portalUrl: string | null; onClose: () => void; onChanged: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<ModalState>({ kind: "loading" });
  const [reason, setReason] = useState("");

  // A native modal dialog: focus is trapped inside, Escape closes it, and focus returns to the button that opened it.
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { if (element?.open) element.close(); };
  }, []);
  const load = () => {
    setState({ kind: "loading" });
    getBillingOverview().then((overview) => setState(modalStateFor(overview)), (error: unknown) => setState({ kind: "error", message: error instanceof Error ? error.message : "Could not reach billing just now.", portalUrl: error instanceof BillingError ? error.portalUrl : null }));
  };
  useEffect(load, []);

  const act = async (kind: "cancel" | "resume") => {
    if (state.kind !== "ready") return;
    setState({ ...state, busy: kind });
    try {
      if (kind === "cancel") await cancelSubscription(reason); else await resumeSubscription();
      const overview = await getBillingOverview();
      const next = modalStateFor(overview);
      setState(next.kind === "ready" ? { ...next, notice: kind === "cancel" ? "Your subscription is cancelled. You can resume it until the period ends." : "Your subscription is back on." } : next);
      setReason("");
      onChanged();
    } catch (error) {
      setState({ ...state, busy: null, confirming: kind === "cancel", notice: error instanceof Error ? error.message : "Something went wrong. Try again." });
    }
  };

  const portal = state.kind === "error" ? (state.portalUrl ?? portalUrl) : portalUrl;
  return (
    <dialog ref={dialog} className="theme-dialog billing-dialog" aria-labelledby="billing-title" onClose={onClose} onClick={(event) => { if (event.target === dialog.current) dialog.current?.close(); }}>
      <div className="theme-dialog-inner">
        <div className="theme-dialog-header">
          <div><h2 id="billing-title">Billing</h2></div>
          <button className="theme-close" type="button" aria-label="Close billing" onClick={() => dialog.current?.close()}>×</button>
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
          return <>
            {state.notice && <p className="profile-note ok" role="status">{state.notice}</p>}

            <section className="billing-section" aria-labelledby="billing-plan">
              <div className="profile-row">
                <div>
                  <b id="billing-plan">{sub.planName} plan{sub.interval === "year" ? " (Annual)" : ""}</b>
                  <p><span className={`billing-status ${view.tone}`}>{view.statusLabel}</span> {view.dateLine}</p>
                </div>
              </div>
              {view.prominentUpdate && sub.updatePaymentUrl && <p className="profile-note bad" role="alert">Your last payment failed. <a className="primary-button" href={sub.updatePaymentUrl} target="_blank" rel="noreferrer">Update payment method</a></p>}
            </section>

            <section className="billing-section" aria-labelledby="billing-card">
              <div className="profile-row">
                <div><b id="billing-card">Payment method</b><p>{cardLine(sub)}</p></div>
                {view.showUpdate && !view.prominentUpdate && sub.updatePaymentUrl && <a className="secondary-button" href={sub.updatePaymentUrl} target="_blank" rel="noreferrer">Update payment method</a>}
              </div>
            </section>

            {tokens && <section className="billing-section" aria-labelledby="billing-tokens"><b id="billing-tokens">Plan tokens this period</b><p>{tokenLine(tokens)}{tokens.resetsAt ? ` Resets ${formatDate(tokens.resetsAt)}.` : ""}</p></section>}

            <section className="billing-section" aria-labelledby="billing-invoices">
              <b id="billing-invoices">Recent invoices</b>
              {invoices.length === 0 ? <p>No invoices yet.</p> : <table className="billing-invoices"><thead><tr><th scope="col">Date</th><th scope="col">Amount</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Receipt</span></th></tr></thead>
                <tbody>{invoiceRows(invoices).map((row) => <tr key={row.id}><td>{row.date}</td><td>{row.amount}</td><td>{row.status}</td><td>{row.url ? <a href={row.url} target="_blank" rel="noreferrer">Receipt</a> : null}</td></tr>)}</tbody></table>}
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
                <button className="secondary-button billing-danger" onClick={() => setState({ ...state, confirming: true, notice: null })}>Cancel subscription</button>
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

        {portal && <p className="billing-portal"><a href={portal} target="_blank" rel="noreferrer">Open full billing portal</a></p>}
      </div>
    </dialog>
  );
}
