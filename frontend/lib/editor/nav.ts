/**
 * Where "back" goes from the editor: the page the person came from (Projects, a storyboard step, Templates), not a fixed
 * page. The browser remembers it as the referrer; it is used only when it is on this site and is not an editor page.
 * Anything else (a bookmark, a pasted link, a page on another site) falls back to the project list.
 */
export function cameFrom(referrer: string, origin: string): string | null {
  if (!referrer) return null;
  try {
    const from = new URL(referrer);
    if (from.origin !== origin || from.pathname.startsWith("/editor")) return null;
    return from.pathname + from.search + from.hash;
  } catch {
    return null;
  }
}

export function goBack() {
  const from = cameFrom(document.referrer, window.location.origin);
  // Go to the page itself rather than one step back in history: the editor may have been reached through redirects or
  // reloads, and a step back then lands somewhere else.
  window.location.assign(from ?? "/studio");
}
