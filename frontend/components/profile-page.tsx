"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "../utils/supabase/client";
import { PLANS, PREVIEW_ALLOWANCE, TOP_UP, annualMonthlyUsd, filmsFromTokens, isPaidTier, validateEmailAddress } from "@videosaas/contracts";
import { getMyPreviews, getMySubscription, getMyTokens, startCheckout, syncPurchase, type PreviewUsage, type Subscription, type TokenSummary } from "../lib/api";
import { AppShell } from "./app-shell";
import { BillingModal } from "./billing-modal";
import { closeOverlay, openOverlayOrPage } from "../lib/lemon";
import { useAccount } from "./account-menu";
import { filmsFrom } from "./plan-cards";
import { ThemeChoicePicker } from "./theme-choice";

/** Profile: who you are, how the site looks, what plan you are on, and what is left to generate with. */
export function ProfilePage() {
  const account = useAccount();
  const [name, setName] = useState("");
  const [saved, setSaved] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [reset, setReset] = useState<"idle" | "sending" | "sent" | "error">("idle");

  useEffect(() => { if (account) setName(account.name); }, [account]);

  const [sub, setSub] = useState<{ status: "loading" } | { status: "error" } | { status: "ready"; value: Subscription }>({ status: "loading" });
  const loadSub = () => { setSub({ status: "loading" }); getMySubscription().then((value) => setSub({ status: "ready", value }), () => setSub({ status: "error" })); };
  const [billingOpen, setBillingOpen] = useState(false);
  const [buying, setBuying] = useState<string | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);
  const buy = async (product: "topup") => {
    setBuying(product); setBuyError(null);
    try {
      const url = await startCheckout(product);
      const before = tokens.status === "ready" ? tokens.value.remaining : null;
      // Checkout opens over this page (Lemon.js); on success the overlay closes and the purchase is applied here, with no redirect.
      await openOverlayOrPage(url, (event) => {
        if (event.event === "Checkout.Success") { closeOverlay(); void activate(true, before); }
        if (event.event === "Checkout.Closed") setBuying(null);
      }, "redirect");
    } catch (caught) { setBuyError(caught instanceof Error ? caught.message : "Could not open checkout."); setBuying(null); }
  };

  const [tokens, setTokens] = useState<{ status: "loading" } | { status: "error" } | { status: "ready"; value: TokenSummary }>({ status: "loading" });
  const loadTokens = () => { setTokens({ status: "loading" }); getMyTokens().then((value) => setTokens({ status: "ready", value }), () => setTokens({ status: "error" })); };

  // After a purchase (the checkout overlay's success event, or a return with ?checkout=success): apply it now rather than
  // waiting for the webhook, then show the new plan and balance. Lemon Squeezy can take a couple of minutes to confirm a
  // payment, so look again with a growing pause for up to about 3 minutes.
  const [activating, setActivating] = useState(false);
  const [slow, setSlow] = useState(false);
  const stopped = useRef(false);
  const activate = async (pack: boolean, startBalance: number | null) => {
    setActivating(true); setBuying(null);
    const started = Date.now();
    for (let attempt = 0; !stopped.current && Date.now() - started < 180_000; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(2000 + attempt * 1500, 10_000)));
      if (stopped.current) return;
      if (attempt === 5) setSlow(true);
      try {
        if (pack) { if (startBalance !== null && (await getMyTokens()).remaining > startBalance) break; }
        else if ((await syncPurchase()).synced) { const view = await getMyTokens().catch(() => null); if (view?.plan && view.plan.granted > 0) break; }
      } catch { /* try again; the webhook may still land first */ }
    }
    if (stopped.current) return;
    // No cache: read the plan and the balance fresh, whatever the outcome.
    loadSub(); loadTokens(); setActivating(false); setSlow(false);
  };
  useEffect(() => {
    stopped.current = false;
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") !== "success") { loadSub(); loadTokens(); }
    else {
      // A return by redirect (the overlay could not open): clean the URL at once so a refresh does not run this again.
      window.history.replaceState(null, "", `${window.location.pathname}#tokens`);
      const pack = params.get("item") === "pack";
      void (pack ? getMyTokens().then((t) => t.remaining, () => null) : Promise.resolve(null)).then((balance) => activate(pack, balance));
    }
    return () => { stopped.current = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveName = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || saved === "saving") return;
    setSaved("saving");
    const { error } = await createClient().auth.updateUser({ data: { full_name: name.trim() } });
    setSaved(error ? "error" : "done");
  };
  const sendReset = async () => {
    if (!account?.email || reset === "sending") return;
    if (!validateEmailAddress(account.email).ok) {
      setReset("error");
      return;
    }
    setReset("sending");
    const { error } = await createClient().auth.resetPasswordForEmail(account.email.trim(), { redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset` });
    setReset(error ? "error" : "sent");
  };

  return (
    <AppShell active="profile">
      <section className="page-container profile-page">
        <div className="page-heading"><div><h1>Profile</h1><p>Your account, how the site looks, your plan and your tokens.</p></div></div>

        {activating && <p className="profile-note" role="status">{slow ? "Payment confirming… this can take a couple of minutes. You can stay on this page; your tokens will appear here." : "Activating your plan… this takes a few seconds."}</p>}

        <article className="profile-card" id="account">
          <h2>Account</h2>
          <form className="profile-form" onSubmit={(event) => void saveName(event)}>
            <label>Name<input value={name} onChange={(event) => { setName(event.target.value); setSaved("idle"); }} maxLength={80} autoComplete="name" /></label>
            <label>Email<input value={account?.email ?? ""} readOnly aria-readonly="true" /></label>
            <div className="profile-actions">
              <button className="primary-button" disabled={!account || !name.trim() || name.trim() === account.name || saved === "saving"}>{saved === "saving" ? "Saving…" : "Save name"}</button>
              {saved === "done" && <span className="profile-note ok" role="status">Saved.</span>}
              {saved === "error" && <span className="profile-note bad" role="alert">Could not save. Try again.</span>}
            </div>
          </form>
          <div className="profile-row">
            <div><b>Password</b><p>We email you a link to choose a new one.</p></div>
            <button className="secondary-button" onClick={() => void sendReset()} disabled={!account?.email || reset === "sending"}>{reset === "sending" ? "Sending…" : "Email me a reset link"}</button>
          </div>
          {reset === "sent" && <p className="profile-note ok" role="status">Check {account?.email} for the link.</p>}
          {reset === "error" && <p className="profile-note bad" role="alert">Could not send the email. Try again.</p>}
        </article>

        <article className="profile-card" id="appearance">
          <h2>Appearance</h2>
          <div className="profile-row"><div><b>Theme</b><p>System follows your device.</p></div><ThemeChoicePicker /></div>
        </article>

        <article className="profile-card" id="plan">
          <h2>Subscription</h2>
          {sub.status === "loading" && <p className="profile-note">Checking your plan…</p>}
          {sub.status === "error" && <div className="profile-row"><div><b>Plan unavailable</b><p>We could not check your plan just now.</p></div><button className="secondary-button" onClick={loadSub}>Try again</button></div>}
          {sub.status === "ready" && <>
            <div className="profile-row">
              <div>
                <b>{PLANS[sub.value.tier].name} plan{sub.value.tier !== "free" && sub.value.interval === "year" ? " (Annual)" : ""}</b>
                <p>{planLine(sub.value)}</p>
              </div>
              <div className="profile-actions">
                {sub.value.tier !== "free" && <button className="secondary-button" type="button" onClick={() => setBillingOpen(true)}>Manage billing</button>}
                <Link className={sub.value.tier === "free" ? "primary-button" : "secondary-button"} href="/pricing">{sub.value.tier === "free" ? "Upgrade plan" : "View plans"}</Link>
              </div>
            </div>
            {sub.value.status === "past_due" && <p className="profile-note bad" role="alert">Your last payment failed. <button className="text-button" type="button" onClick={() => setBillingOpen(true)}>Update your payment method</button> to keep your plan.</p>}
          </>}
        </article>

        {billingOpen && <BillingModal onClose={() => setBillingOpen(false)} onChanged={() => {
          // Refresh the cards behind the modal without unmounting it (a loading state would close it and lose its notice).
          getMySubscription().then((value) => setSub({ status: "ready", value }), () => undefined);
          getMyTokens().then((value) => setTokens({ status: "ready", value }), () => undefined);
        }} />}

        <article className="profile-card" id="tokens">
          <h2>Tokens</h2>
          {tokens.status === "loading" && <p className="profile-note">Reading your tokens…</p>}
          {tokens.status === "error" && <div className="profile-row"><div><b>Tokens unavailable</b><p>We could not read your balance just now.</p></div><button className="secondary-button" onClick={loadTokens}>Try again</button></div>}
          {tokens.status === "ready" && <TokenMeter value={tokens.value} renewsAt={sub.status === "ready" ? (sub.value.tokensResetAt ?? sub.value.renewsAt) : null} />}
          {sub.status === "ready" && (sub.value.tier === "free" ? (
            <div className="profile-row topup">
              <div><b>Need more?</b><p>Subscribe to a plan: every plan comes with tokens each month.</p></div>
              <Link className="primary-button" href="/pricing">Subscribe</Link>
            </div>
          ) : (
            <div className="profile-row topup">
              <div><b>Need more?</b><p>{TOP_UP.tokens} tokens for ${TOP_UP.priceUsd}. They never expire.</p></div>
              <button className="secondary-button" disabled={buying !== null} onClick={() => void buy("topup")}>{buying === "topup" ? "Opening…" : "Buy tokens"}</button>
            </div>
          ))}
          {buyError && <p className="profile-note bad" role="alert">{buyError}</p>}
        </article>
      </section>
    </AppShell>
  );
}

const REASONS: Record<string, string> = {
  render: "Video rendered",
  render_export: "Final video export",
  script: "Script written",
  script_edit: "Script edited",
  scene_insert: "Scene added",
  beat_rewrite: "Frame rewritten",
  storyboard: "Storyboard planned",
  frames: "Storyboard frames drawn",
  voice: "Voiceover & music",
  animation: "Animation generated",
  plate_draw: "Animated scenes drawn",
  plate_fix: "Scene revision",
  plate_aspect: "Format drawn",
  element_edit: "Comment edit applied",
  pro_assist: "Pro editor AI edit",
  material: "Generated scenes",
  revision: "Change to a film",
  grant: "Tokens added",
  adjust: "Adjustment",
  refund: "Tokens returned",
  expiry: "Last month's unused tokens expired"
};
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const num = (n: number) => String(Math.round(n * 100) / 100);
const planLine = (s: Subscription) => {
  const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  if (s.tier === "free") return `One watermarked film of up to 90 seconds, with ${PREVIEW_ALLOWANCE.free} films to try.`;
  const plan = PLANS[s.tier];
  const priceText = s.interval === "year" && isPaidTier(s.tier)
    ? `$${plan.annualPriceUsd} a year ($${annualMonthlyUsd(s.tier).toFixed(2)} a month)`
    : `$${plan.priceUsd} a month`;
  if (s.cancelAtPeriodEnd && s.endsAt) return `${priceText}. Cancels on ${date(s.endsAt)}: you keep this plan until then.`;
  return `${priceText} · ${plan.tokens.toLocaleString()} tokens each month.${s.renewsAt ? ` Renews ${date(s.renewsAt)}.` : ""}`;
};

/** Films worked on this period against the plan's allowance: storyboards, voice and motion are free to try, up to this many films. */
function PreviewMeter() {
  const [usage, setUsage] = useState<PreviewUsage | null>(null);
  useEffect(() => { getMyPreviews().then(setUsage, () => setUsage(null)); }, []);
  if (!usage) return null;
  const left = Math.max(usage.limit - usage.used, 0);
  return <p className="token-extra">{usage.used} of {usage.limit} films {usage.tier === "free" ? "tried on the free plan" : "started this month"} · {left} {left === 1 ? "film" : "films"} left to preview{usage.tier === "free" ? "" : ", resets on the 1st"}.</p>;
}

function TokenMeter({ value, renewsAt }: { value: TokenSummary; renewsAt: string | null }) {
  const plan = value.plan;
  // With a plan the meter is the month: it starts at 0% used on every renewal. Without one it is the free allowance.
  const view = plan ?? value.free;
  const usedPct = view.granted <= 0 ? 0 : Math.max(0, Math.min(100, Math.round((view.used / view.granted) * 100)));
  const extra = plan ? value.free.remaining + value.packs.remaining : value.packs.remaining;
  const films = filmsFrom(Math.max(value.remaining, 0));
  return (
    <div className="token-meter">
      <b>{num(Math.max(view.remaining, 0))} {plan ? "plan " : ""}tokens left</b>
      <span className="token-sub">{plan ? `${usedPct}% of this month used · ${num(view.used)} of ${num(view.granted)}` : `${usedPct}% used · ${num(view.used)} of ${num(view.granted)}`}{plan && renewsAt ? ` · resets ${new Date(renewsAt).toLocaleDateString(undefined, { month: "long", day: "numeric" })}` : ""}</span>
      <div className="token-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={usedPct} aria-label="Share of this month's tokens used"><i style={{ width: `${usedPct}%` }} /></div>
      <PreviewMeter />
      {extra > 0 && <p className="token-extra">Plus {num(extra)} extra tokens ({plan ? "free allowance and packs" : "packs"}) that do not expire.</p>}
      <p className="token-extra">Enough for about {films} {films === 1 ? "film" : "films"} of 30 seconds in total.{plan ? " Unused plan tokens do not carry over to next month." : ""}</p>
      {value.recent.length === 0 ? <p>Nothing used yet.</p> : (
        <ul className="token-log">{value.recent.map((entry) => <li key={entry.id}><span>{REASONS[entry.reason] ?? REASONS[entry.kind] ?? entry.reason}{entry.kind === "grant" ? ` · ${entry.reason}` : ""}</span><time>{when(entry.createdAt)}</time><b className={entry.amount > 0 ? "plus" : ""}>{entry.amount > 0 ? "+" : ""}{num(entry.amount)}</b></li>)}</ul>
      )}
    </div>
  );
}
