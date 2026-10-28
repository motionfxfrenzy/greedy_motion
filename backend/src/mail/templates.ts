// GreedyMotion's account emails (confirmation, password reset, sign-in link, invite, re-authentication, welcome) in the
// site's own look: the logo, the blue button, Plus Jakarta Sans where the mail client has it. Table layout with inline
// styles, because mail clients ignore everything else. Every auth email carries the code and, where there is one, the link.
import type { MailMessage } from "./send.ts";

export const LOGO_URL = "https://greedymotion.com/brand/greedy-motion-logo-final.png";
export const SITE_URL = "https://greedymotion.com";
export const SUPPORT_EMAIL = "support@greedymotion.com";

export type AuthAction = "signup" | "recovery" | "magiclink" | "invite" | "reauthentication";

type Copy = { subject: string; preheader: string; heading: string; lead: string; button?: string };
const copy: Record<AuthAction, Copy> = {
  signup: { subject: "Confirm your GreedyMotion account", preheader: "Confirm your email to start making videos.", heading: "Confirm your email", lead: "Welcome to GreedyMotion. Press the button, or enter the code, to confirm your email and finish creating your account.", button: "Confirm email" },
  recovery: { subject: "Reset your GreedyMotion password", preheader: "Choose a new password for your account.", heading: "Reset your password", lead: "We got a request to reset the password for your GreedyMotion account. Press the button, or enter the code, to choose a new one.", button: "Choose a new password" },
  magiclink: { subject: "Your GreedyMotion sign-in link", preheader: "Sign in to GreedyMotion.", heading: "Sign in to GreedyMotion", lead: "Press the button, or enter the code, to sign in.", button: "Sign in" },
  invite: { subject: "You're invited to GreedyMotion", preheader: "Accept your invite to GreedyMotion.", heading: "You're invited", lead: "You have been invited to GreedyMotion. Press the button, or enter the code, to accept and set up your account.", button: "Accept invite" },
  reauthentication: { subject: "Your GreedyMotion verification code", preheader: "Your GreedyMotion verification code.", heading: "Verify it's you", lead: "Enter this code to confirm the change you are making to your account." }
};

export const authActions = Object.keys(copy) as AuthAction[];

// The rule Supabase enforces for this project's passwords (Authentication > Email); the reset email says it so the
// new password is right the first time.
export const PASSWORD_RULE = "at least 8 characters, with a lowercase letter, an uppercase letter and a number";

const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const font = "'Plus Jakarta Sans',-apple-system,'Segoe UI',Arial,sans-serif";

const bluePill = (href: string, label: string) =>
  `<a href="${esc(href)}" style="display:inline-block;padding:14px 32px;border-radius:999px;background:#0a6cff;color:#ffffff;font-family:${font};font-size:15px;font-weight:700;text-decoration:none">${esc(label)}</a>`;

/** The page every email shares: logo, white card holding `rows` (table rows), footer under it. */
function frame({ title, preheader, rows, footer }: { title: string; preheader: string; rows: string; footer: string }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#ebf5ff">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#ebf5ff">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ebf5ff"><tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;table-layout:fixed">
    <tr><td align="center" style="padding:0 0 20px"><a href="${SITE_URL}"><img src="${LOGO_URL}" width="190" alt="GreedyMotion" style="display:block;border:0;height:auto;width:190px"></a></td></tr>
    <tr><td style="background:#fafdff;border:1px solid #e1eaf4;border-radius:20px;padding:36px 32px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed">
        ${rows}
      </table>
    </td></tr>
    <tr><td align="center" style="padding:20px 8px 0;font-family:${font};font-size:12px;line-height:18px;color:#71717a">${footer}<br>Need help? <a href="mailto:${SUPPORT_EMAIL}" style="color:#0a6cff;text-decoration:none">${SUPPORT_EMAIL}</a><br><a href="${SITE_URL}" style="color:#0a6cff;text-decoration:none">GreedyMotion</a> · Product videos, made fast.</td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

/** `expiresMinutes` is Supabase's Email OTP expiration (300 s here): the code and the link stop working together. */
export type AuthEmailInput = { action: AuthAction; to: string; code: string; link?: string; name?: string; expiresMinutes?: number; copyLink?: string };

export function authEmail({ action, to, code, link, name, expiresMinutes = 5, copyLink }: AuthEmailInput): MailMessage {
  const c = copy[action];
  const showLink = Boolean(c.button && link);
  const hello = name ? `Hi ${esc(name)},` : "Hi,";
  const expires = `Expires in ${expiresMinutes} minutes`;
  const rule = action === "recovery" ? `Your new password needs ${PASSWORD_RULE}.` : "";

  const button = showLink ? `<tr><td align="center" style="padding:8px 0 28px">${bluePill(link!, c.button!)}</td></tr>` : "";
  const orCode = showLink ? `<tr><td align="center" style="padding:0 0 10px;font-family:${font};font-size:13px;color:#71717a">or enter this code</td></tr>` : "";
  // Mail clients cannot copy to the clipboard and Gmail rewrites a pasted URL into a long blue link, so "copy" is a button to a
  // page on the site (app/auth/link) that has a real Copy button.
  const linkFallback = showLink && copyLink
    ? `<tr><td style="height:28px;line-height:28px;font-size:0">&nbsp;</td></tr>
        <tr><td align="center" style="padding:22px 0 12px;border-top:1px solid #e1eaf4;font-family:${font};font-size:13px;color:#71717a">Button not working, or it opens in the wrong browser?</td></tr>
        <tr><td align="center"><a href="${esc(copyLink)}" style="display:inline-block;padding:11px 26px;border-radius:999px;border:1.5px solid #0a6cff;background:#ffffff;color:#0a6cff;font-family:${font};font-size:14px;font-weight:700;text-decoration:none">Copy link</a></td></tr>`
    : "";

  const html = frame({
    title: c.subject,
    preheader: c.preheader,
    rows: `<tr><td style="font-family:${font};font-size:24px;line-height:30px;font-weight:800;color:#0a0d12;padding:0 0 12px">${esc(c.heading)}</td></tr>
        <tr><td style="font-family:${font};font-size:15px;line-height:24px;color:#52525b;padding:0 0 24px">${hello}<br>${esc(c.lead)}</td></tr>
        ${button}
        ${orCode}
        <tr><td align="center" style="padding:0 0 4px"><div style="display:inline-block;padding:14px 26px;border-radius:14px;background:#f6fafe;border:1px solid #e1eaf4;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:30px;line-height:36px;font-weight:700;letter-spacing:8px;color:#0a0d12">${esc(code)}</div></td></tr>
        <tr><td align="center" style="padding:10px 0 0;font-family:${font};font-size:13px;font-weight:600;color:#0a6cff">${expires}</td></tr>
        ${rule ? `<tr><td style="padding:22px 0 0;font-family:${font};font-size:13px;line-height:20px;color:#52525b">${esc(rule)}</td></tr>` : ""}
        ${linkFallback}`,
    footer: `This was sent to ${esc(to)}. The code and link expire in ${expiresMinutes} minutes; if they run out, request a new email at <a href="${SITE_URL}/auth" style="color:#0a6cff;text-decoration:none">greedymotion.com/auth</a>. If you didn't ask for this, you can ignore it and nothing will change.`
  });

  const text = [
    c.heading,
    "",
    `${name ? `Hi ${name},` : "Hi,"} ${c.lead}`,
    "",
    ...(showLink ? [`${c.button}: ${link}`, "", "Or enter this code:"] : ["Your code:"]),
    code,
    `${expires}.`,
    ...(rule ? ["", rule] : []),
    "",
    `This was sent to ${to}. The code and link expire in ${expiresMinutes} minutes; if they run out, request a new email at ${SITE_URL}/auth. If you didn't ask for this, you can ignore it and nothing will change.`,
    "",
    `Need help? ${SUPPORT_EMAIL}`,
    `GreedyMotion · ${SITE_URL}`
  ].join("\n");

  return { to, subject: c.subject, html, text };
}

export type WelcomeEmailInput = { to: string; name?: string; appUrl: string };

/** Sent once, right after an account is confirmed. Replies are meant for the support address (the caller sets reply-to). */
export function welcomeEmail({ to, name, appUrl }: WelcomeEmailInput): MailMessage {
  const subject = "Welcome to GreedyMotion";
  const hello = name ? `Hi ${esc(name)},` : "Hi,";
  const open = `${appUrl.replace(/\/$/, "")}/studio`;
  const lead = "Your account is confirmed and your workspace is ready. Start making product videos whenever you like.";
  const supportLine = "To send us feedback, or if you want support, contact us at";

  const html = frame({
    title: subject,
    preheader: "Your account is ready. We're here if you need us.",
    rows: `<tr><td style="font-family:${font};font-size:24px;line-height:30px;font-weight:800;color:#0a0d12;padding:0 0 12px">Welcome to GreedyMotion</td></tr>
        <tr><td style="font-family:${font};font-size:15px;line-height:24px;color:#52525b;padding:0 0 24px">${hello}<br>${esc(lead)}</td></tr>
        <tr><td align="center" style="padding:8px 0 28px">${bluePill(open, "Open your workspace")}</td></tr>
        <tr><td style="padding:22px 0 0;border-top:1px solid #e1eaf4;font-family:${font};font-size:14px;line-height:22px;color:#52525b"><strong style="color:#0a0d12">Feedback or need help?</strong><br>${supportLine} <a href="mailto:${SUPPORT_EMAIL}" style="color:#0a6cff;font-weight:700;text-decoration:none">${SUPPORT_EMAIL}</a>.</td></tr>`,
    footer: `This was sent to ${esc(to)} because you created a GreedyMotion account. Replying to this email reaches our support team.`
  });

  const text = [
    "Welcome to GreedyMotion",
    "",
    `${name ? `Hi ${name},` : "Hi,"} ${lead}`,
    "",
    `Open your workspace: ${open}`,
    "",
    "Feedback or need help?",
    `${supportLine} ${SUPPORT_EMAIL}.`,
    "",
    `This was sent to ${to} because you created a GreedyMotion account. Replying to this email reaches our support team.`,
    `GreedyMotion · ${SITE_URL}`
  ].join("\n");

  return { to, subject, html, text };
}
