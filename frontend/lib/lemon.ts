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

/** Opens `url` (a checkout or an update-payment-method link) as an overlay and reports Lemon.js events until it closes. */
export async function openOverlay(url: string, onEvent: (event: LemonEvent) => void): Promise<void> {
  const lemon = await load();
  listener = onEvent;
  lemon.Url.Open(embedUrl(url));
}

export const closeOverlay = () => {
  try { window.LemonSqueezy?.Url.Close(); } catch { /* already closed */ }
};
