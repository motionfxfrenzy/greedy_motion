/// <reference lib="dom" />
// Functions serialised into the captured page by Puppeteer (page.evaluate): they run in the browser,
// not in Node, so they may only use their arguments and browser globals.

export type PageFacts = { title: string; description: string; facts: string[]; text: string; colors: string[]; images: { url: string; alt: string }[]; sections: { index: number; top: number; height: number; heading: string }[] };

/** Runs in the page: facts from the rendered DOM, overlays hidden, section boxes marked. */
export function inPage(rules: { factsMax: number; textMax: number; minH: number; maxShots: number }): PageFacts {
  const clean = (t: string) => t.replace(/\s+/g, " ").trim();
  const visible = (el: Element) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05; };
  // Overlays: cookie bars, chat bubbles and modals are hidden; a fixed header is pinned to the page top.
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
    const cs = getComputedStyle(el);
    if (cs.position === "sticky") { el.style.setProperty("position", "relative", "important"); continue; }
    if (cs.position !== "fixed") continue;
    const r = el.getBoundingClientRect();
    if (r.top <= 2 && r.height < 160 && r.width > innerWidth * 0.6) el.style.setProperty("position", "absolute", "important");
    else el.style.setProperty("display", "none", "important");
  }
  const facts: string[] = [];
  const seen = new Set<string>();
  const chrome = "nav, header, footer, [role='navigation'], [role='menu'], [aria-hidden='true']";
  for (const el of Array.from(document.querySelectorAll("h1, h2, h3, button, a, li"))) {
    if (!visible(el)) continue;
    // Navigation, menus and footers are site chrome, not product facts (headings in a header still count).
    if (!/^H\d$/.test(el.tagName) && el.closest(chrome)) continue;
    let value = clean((el as HTMLElement).innerText || "");
    // Animated headings often repeat their text (a visible copy and a measuring copy).
    const half = value.slice(0, Math.floor(value.length / 2)).trim();
    if (half.length > 8 && value === `${half} ${half}`) value = half;
    const words = value.split(" ").length;
    const tag = el.tagName.toLowerCase();
    const keep = tag.startsWith("h") ? words <= 16 : tag === "li" ? words >= 3 && words <= 18 : words >= 2 && words <= 5;
    if (keep && value.length >= 3 && !seen.has(value.toLowerCase())) { seen.add(value.toLowerCase()); facts.push(value); }
    if (facts.length >= rules.factsMax) break;
  }
  const W = innerWidth;
  const candidates = Array.from(document.querySelectorAll<HTMLElement>("header, section, footer, main > *, body > div > *, body > div > div > *, [class*='hero' i], [class*='section' i]"))
    .filter(visible)
    .map((el) => { const r = el.getBoundingClientRect(); return { el, top: Math.round(r.top + scrollY), height: Math.round(r.height), width: r.width }; })
    .filter((c) => c.width >= W * 0.7 && c.height >= rules.minH && c.height <= 3200)
    .sort((a, b) => a.top - b.top || b.height - a.height);
  // Not worth a screenshot: legal text, footers, cookie and newsletter bands, sign-up and contact forms, link lists.
  const legal = /\b(terms|conditions|privacy|policy|policies|cookie|cookies|legal|copyright|disclaimer|newsletter|subscribe|unsubscribe|sitemap|careers|all rights reserved|©)\b/i;
  const boring = (el: HTMLElement) => {
    if (el.tagName === "FOOTER" || el.closest("footer")) return true;
    if (/footer|legal|cookie|newsletter|subscribe|terms|privacy|disclaimer|sitemap/i.test(`${el.id} ${el.className && typeof el.className === "string" ? el.className : ""}`)) return true;
    const text = clean(el.innerText || "");
    if (legal.test(clean(el.querySelector("h1, h2, h3")?.textContent || "")) || (text.length > 200 && (text.match(new RegExp(legal.source, "gi")) ?? []).length >= 3)) return true;
    // A band of plain links (or almost no content: no picture and little text) is navigation, not a section of the product.
    const links = el.querySelectorAll("a").length, pics = el.querySelectorAll("img, picture, video, canvas, svg").length;
    return (links >= 12 && text.length / Math.max(links, 1) < 24 && pics < 3) || (pics === 0 && text.length < 60);
  };
  const picked: typeof candidates = [];
  let bottom = 0;
  for (const c of candidates) {
    if (c.top < bottom - 24) continue;
    if (boring(c.el)) continue;
    const heading = c.el.querySelector("h1, h2, h3");
    if (!heading && picked.length > 0) continue;
    picked.push(c);
    bottom = c.top + c.height;
    if (picked.length >= rules.maxShots) break;
  }
  const sections = picked.map((c, index) => {
    c.el.setAttribute("data-gm-section", String(index));
    const h = c.el.querySelector("h1, h2, h3") as HTMLElement | null;
    return { index, top: c.top, height: c.height, heading: clean(h?.innerText || c.el.getAttribute("aria-label") || "").slice(0, 80) };
  });
  // Brand colours as the page uses them: CTA fills, link colours, logo and icon fills. Greys, near-white
  // and near-black are skipped; pale tints count little (they are backgrounds, not the brand).
  const tally = new Map<string, number>();
  const add = (value: string, weight: number) => {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(value);
    if (!m || (m[4] !== undefined && Number(m[4]) < 0.6)) return;
    const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255, l = (max + min) / 2;
    const sat = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
    if (sat < 0.3 || l < 0.12 || l > 0.9) return;
    const hex = "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
    // The browser's own link colours (unstyled <a>) are not the brand; every unstyled link would otherwise vote for blue.
    if (hex === "#0000ee" || hex === "#551a8b") return;
    tally.set(hex, (tally.get(hex) ?? 0) + weight * (l > 0.78 ? 0.2 : 1));
  };
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("button, a, [role='button'], [class*='btn' i], [class*='button' i]")).slice(0, 400)) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    add(cs.backgroundColor, 5);
    add(cs.color, 1.5);
    add(cs.borderColor, 1);
  }
  for (const el of Array.from(document.querySelectorAll<SVGElement>("header svg *, nav svg *, [class*='logo' i] *, svg [fill], svg [stroke]")).slice(0, 600)) {
    const cs = getComputedStyle(el);
    add(cs.fill, el.closest("header, nav, [class*='logo' i]") ? 4 : 1);
    add(cs.stroke, 1);
  }
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("h1 *, h2 *, mark, [class*='accent' i], [class*='highlight' i]")).slice(0, 300)) add(getComputedStyle(el).color, 2);
  const colors = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex).slice(0, 8);
  // Pictures that show the product: large, in the page's own content (not the header, footer or a nav), not logos, icons,
  // badges, avatars or tracking pixels; one per source, biggest first. The share image leads when it is large enough.
  const imgs: { url: string; alt: string; area: number }[] = [];
  const seenImg = new Set<string>();
  for (const el of Array.from(document.images)) {
    const r = el.getBoundingClientRect();
    const src = el.currentSrc || el.src;
    if (!/^https?:/i.test(src) || !visible(el) || r.width < 280 || r.height < 180 || (el.naturalWidth && el.naturalWidth < 400)) continue;
    if (el.closest("header, nav, footer, [role='navigation'], [class*='cookie' i], [class*='logo' i], [class*='avatar' i], [class*='badge' i], [class*='payment' i]")) continue;
    if (/logo|icon|sprite|avatar|badge|payment|flag|pixel|tracking|placeholder|loading|blog|banner-?(terms|cookie)|terms|conditions/i.test(`${src} ${el.alt} ${el.className}`)) continue;
    const key = src.split("?")[0];
    if (seenImg.has(key)) continue;
    seenImg.add(key);
    imgs.push({ url: src, alt: clean(el.alt || el.closest("a")?.getAttribute("aria-label") || "").slice(0, 80), area: r.width * r.height });
  }
  const og = (document.querySelector("meta[property='og:image']") as HTMLMetaElement | null)?.content;
  const images = [...(og && /^https?:/i.test(og) && !/logo|icon|favicon|placeholder/i.test(og) && !seenImg.has(og.split("?")[0]) ? [{ url: og, alt: "Share image", area: 1e9 }] : []), ...imgs.sort((a, b) => b.area - a.area)].slice(0, 8).map(({ url, alt }) => ({ url, alt }));
  const description = (document.querySelector("meta[name='description'], meta[property='og:description']") as HTMLMetaElement | null)?.content || "";
  return { title: clean(document.title).slice(0, 160), description: clean(description).slice(0, 300), facts, text: clean(document.body.innerText || "").slice(0, rules.textMax), colors, images, sections };
}

/** Runs in the page: a self-contained copy of one section with computed styles inlined. */
export function snapshotSection(index: number, maxBytes: number): string | null {
  const root = document.querySelector(`[data-gm-section="${index}"]`) as HTMLElement | null;
  if (!root) return null;
  const props = ["display", "position", "top", "left", "right", "bottom", "width", "height", "min-height", "max-width", "margin", "padding", "box-sizing", "flex-direction", "flex-wrap", "justify-content", "align-items", "align-self", "gap", "grid-template-columns", "grid-template-rows", "grid-column", "grid-row", "flex", "order", "color", "background-color", "background-image", "background-size", "background-position", "border", "border-radius", "box-shadow", "opacity", "overflow", "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "text-align", "text-transform", "text-decoration", "white-space", "object-fit", "transform", "z-index", "fill", "stroke"];
  const clone = root.cloneNode(true) as HTMLElement;
  const originals = [root, ...Array.from(root.querySelectorAll("*"))];
  const copies = [clone, ...Array.from(clone.querySelectorAll("*"))];
  if (originals.length > 4000) return null;
  // Defaults are dropped so the snapshot stays small; only what differs from a plain element is kept.
  const skip = new Set(["none", "normal", "auto", "0px", "static", "visible", "rgba(0, 0, 0, 0)", "0px none rgb(0, 0, 0)", "start", "nowrap normal", "0 1 auto", "0", "stretch", "row", "1"]);
  originals.forEach((el, i) => {
    const copy = copies[i] as HTMLElement;
    if (!copy) return;
    const tag = copy.tagName.toLowerCase();
    if (["script", "iframe", "object", "embed", "form", "input", "textarea", "video", "audio", "link", "meta", "noscript"].includes(tag)) { copy.remove(); return; }
    for (const attr of Array.from(copy.attributes)) if (/^on|^data-|^srcset$|^integrity$|^nonce$|^href$|^action$/i.test(attr.name)) copy.removeAttribute(attr.name);
    if (tag === "img") { const src = (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src; if (/^https?:|^data:/.test(src)) copy.setAttribute("src", src); else copy.remove(); }
    const cs = getComputedStyle(el);
    copy.setAttribute("style", props.map((p) => [p, cs.getPropertyValue(p)]).filter(([p, v]) => v && !skip.has(v) && !(p === "opacity" && v === "1")).map(([p, v]) => `${p}:${v}`).join(";"));
  });
  const html = `<div data-source="site-snapshot" style="width:${root.getBoundingClientRect().width}px;position:relative">${clone.outerHTML}</div>`;
  return html.length <= maxBytes ? html : null;
}

