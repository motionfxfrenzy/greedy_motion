// Two hosts, one Next app: the landing site (www.greedymotion.com) and the product (app.greedymotion.com).
// Both variables unset (local dev, preview deploys) means no split: every path is served from wherever it is requested.
// NEXT_PUBLIC_COOKIE_DOMAIN (e.g. ".greedymotion.com") lets the landing site see the signed-in session the app sets.
const clean = (value: string | undefined) => (value ?? "").trim().replace(/\/$/, "");

export const SITE_ORIGIN = clean(process.env.NEXT_PUBLIC_SITE_ORIGIN);
export const APP_ORIGIN = clean(process.env.NEXT_PUBLIC_APP_ORIGIN);
export const COOKIE_DOMAIN = clean(process.env.NEXT_PUBLIC_COOKIE_DOMAIN) || undefined;
export const hostsSplit = Boolean(SITE_ORIGIN && APP_ORIGIN);

/** Paths that belong to the product, not the landing site. */
export const APP_PATH = /^\/(studio|app|auth|film|templates|brand-kits|library|profile|editor)(\/|$)/;

/** A link into the product: absolute on the landing host, plain relative everywhere else. */
export const appHref = (path: string) => (hostsSplit ? `${APP_ORIGIN}${path}` : path);
/** A link to the landing site from inside the product. */
export const siteHref = (path: string) => (hostsSplit ? `${SITE_ORIGIN}${path}` : path);
