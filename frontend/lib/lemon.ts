// Lemon.js, Lemon Squeezy's official script, opens checkout and the update-payment-method page as an overlay inside our
// own page, so the buyer never leaves the app and card details never touch our servers. The script has no versioned URL:
// this is the one documented address.
const SRC = "https://assets.lemonsqueezy.com/lemon.js";

export type LemonEvent = { event: string; data?: unknown };
type LemonGlobal = { Setup: (options: { eventHandler?: (event: LemonEvent) => void }) => void; Url: { Open: (url: string) => void; Close: () => void } };
declare global { interface Window { createLemonSqueezy?: () => void; LemonSqueezy?: LemonGlobal } }

export const OVERLAY_ERROR = "Could not open the secure payment window. Check your connection or ad blocker and try again.";

/** Lemon Squeezy shows a link in the overlay only when it carries embed=1. */
export function embedUrl(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("embed", "1");
  return parsed.toString();
}

let loading: Promise<LemonGlobal> | null = null;
let listener: ((event: LemonEvent) => void) | null = null;

function load(): Promise<LemonGlobal> {
  loading ??= new Promise<LemonGlobal>((resolve, reject) => {
    const fail = () => { loading = null; reject(new Error(OVERLAY_ERROR)); };
    const ready = () => {
      window.createLemonSqueezy?.();
      if (!window.LemonSqueezy) return fail();
      window.LemonSqueezy.Setup({ eventHandler: (event) => listener?.(event) });
      resolve(window.LemonSqueezy);
    };
    if (window.LemonSqueezy) return ready();
    const script = document.createElement("script");
    script.src = SRC;
    script.defer = true;
    script.onload = ready;
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * Resolves when the overlay is gone. Lemon.js documents one close event, PaymentMethodUpdate.Closed, and none for
 * checkout, so closing is also detected from the page: the overlay is an iframe on a lemonsqueezy.com address. It
 * resolves when that iframe has appeared and then disappeared, or has not appeared within `appearMs` (it failed to open),
 * or after `maxMs`. Injectable so it can be tested without a browser.
 */
export async function watchUntilGone(present: () => boolean, options: { pollMs?: number; appearMs?: number; maxMs?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<"closed" | "never-opened" | "timeout"> {
  const { pollMs = 400, appearMs = 10_000, maxMs = 30 * 60_000, sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) } = options;
  let waited = 0, seen = false;
  while (waited < maxMs) {
    if (present()) seen = true;
    else if (seen) return "closed";
    else if (waited >= appearMs) return "never-opened";
    await sleep(pollMs);
    waited += pollMs;
  }
  return "timeout";
}

const overlayPresent = () => typeof document !== "undefined" && document.querySelector('iframe[src*="lemonsqueezy.com"]') !== null;
const CLOSE_BAR_ID = "lemon-close-bar";

/** Our own close button, above Lemon.js's full-screen overlay and next to its card (the overlay's own × is in the far corner). */
function showCloseBar(onClose: () => void) {
  if (document.getElementById(CLOSE_BAR_ID)) return;
  const bar = document.createElement("button");
  bar.id = CLOSE_BAR_ID;
  bar.type = "button";
  bar.textContent = "✕  Close";
  bar.setAttribute("aria-label", "Close the secure payment window");
  bar.style.cssText = "position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2147483647;padding:10px 20px;border:1px solid #cfd8e3;border-radius:9999px;background:#fff;color:#0a0d12;font:600 14px system-ui,sans-serif;box-shadow:0 6px 20px rgba(10,13,18,.25);cursor:pointer";
  bar.onclick = onClose;
  document.body.appendChild(bar);
}
function hideCloseBar() {
  const bar = document.getElementById(CLOSE_BAR_ID);
  if (bar) bar.parentNode?.removeChild(bar);
}

export const closeOverlay = () => {
  try { window.LemonSqueezy?.Url.Close(); } catch { /* already closed */ }
  hideCloseBar();
};

export type OverlayHandle = {
  /** Resolves, once, when the overlay is gone however it ended: success, the buyer closing it, our Close button, or it never opened. */
  closed: Promise<void>;
};

/** Opens `url` (a checkout or an update-payment-method link) as an overlay and reports Lemon.js events until it closes. */
export async function openOverlay(url: string, onEvent: (event: LemonEvent) => void): Promise<OverlayHandle> {
  const lemon = await load();
  listener = onEvent;
  lemon.Url.Open(embedUrl(url));
  showCloseBar(closeOverlay);
  const closed = watchUntilGone(overlayPresent).then(() => { hideCloseBar(); });
  return { closed };
}

/**
 * Overlay first. Card entry is the one thing that may leave the app, so when Lemon.js cannot load (an ad blocker, a
 * network error) the secure page is opened plainly: a checkout in this tab (it returns to the profile page, which then
 * applies the purchase), the update-card page in a new tab. `closed` resolves at once for a plain page.
 */
export async function openOverlayOrPage(url: string, onEvent: (event: LemonEvent) => void, fallback: "redirect" | "tab"): Promise<{ how: "overlay" | "page"; closed: Promise<void> }> {
  try { return { how: "overlay", closed: (await openOverlay(url, onEvent)).closed }; }
  catch {
    if (fallback === "redirect") window.location.assign(url); else window.open(url, "_blank", "noopener");
    return { how: "page", closed: Promise.resolve() };
  }
}
