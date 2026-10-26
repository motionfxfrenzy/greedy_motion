// COPY DEFAULTS: every field a module may ask for is filled from the brand and the facts the caller supplied; nothing is invented that
// would be a product claim (a proof badge or a re-skin set is only present when the caller gives it).
const splitHead = (t) => { const w = t.replace(/[.]$/, "").split(" "); if (w.length === 1) return [w[0] + ".", null]; const k = Math.ceil(w.length / 2); return [w.slice(0, k).join(" "), w.slice(k).join(" ") + "."]; };
const rapidFrom = (f, steps = []) => f.concat((steps || []).map((s) => ({ title: s, detail: "" }))).slice(0, 6).map((x, i) => ({ kicker: ["ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX"][i] + " · " + x.title.toUpperCase().slice(0, 22), head: splitHead(x.title) }));
export function fillCopy(brand, product = {}) {
  const f = product.features?.length >= 3 ? product.features : [{ title: "Fast setup", detail: `Start with ${brand.name} in minutes.`, glyph: "1" }, { title: "Clear results", detail: "See what changed, at a glance.", glyph: "2" }, { title: "Built to share", detail: "Bring the whole team along.", glyph: "3" }];
  f.forEach((x, i) => (x.glyph ||= String(i + 1)));
  const rows = product.rows?.length >= 6 ? product.rows : f.concat(f).slice(0, 6).map((x, i) => ({ date: `Mon ${i + 1}`, label: x.title, amount: `${(i + 2) * 120}`, ok: "Done", alt: "Review" }));
  return {
    prompt: product.prompt || `Show me what ${brand.name} does.`,
    hook: product.hook || ((w) => { const k = Math.ceil(w.length / 2); return [w.slice(0, k).join(" "), w.slice(k).join(" ") || brand.name]; })(brand.tagline.replace(/[.!]$/, "").split(" ")),
    kicker: product.kicker || brand.name.toUpperCase(),
    features: f, rows, stat: product.stat || { n: 100, suffix: "%", label: "less busywork", kicker: "In numbers" },
    lines: product.lines || f.map((x) => x.title), steps: product.steps || f.map((x) => x.title).concat(["Done"]).slice(0, 4), recap: product.recap || f.map((x) => x.title),
    cta: product.cta || "Get started", integrations: product.integrations || [], icons: product.icons || [["A", "A"], ["✓", "B"], ["≡", "C"], ["↗", "A"], ["◎", "B"], ["▦", "C"], ["⌘", "A"], ["%", "B"]],
    chat: product.chat || { user: `How does ${brand.name} work?`, reply: `It takes care of the busywork, so you do not have to.`, actions: ["Try it", "See more"] },
    before: product.before || { kicker: "Before", items: ["Manual", "Scattered", "Slow"] }, after: product.after || { kicker: "With " + brand.name, items: ["Automatic", "In one place", "Fast"] },
    screens: product.screens || [], windowTitle: product.windowTitle || brand.name, liveLabel: product.liveLabel || "Live", dashTitle: product.dashTitle || "Overview", period: product.period || "Sep",
    listTitle: product.listTitle || "Items", listBadge: product.listBadge || "New", reportTitle: product.reportTitle || "Reports", ok: product.ok || "Done", pending: product.pending || "Working",
    nextLabel: product.nextLabel || "Next", nextFlow: product.nextFlow || f.map((x) => x.title).slice(0, 3).join(" → "), trioKicker: product.trioKicker || "What you get", stepsKicker: product.stepsKicker || "How it works",
    cycle: product.cycle || { lead: "All in", words: f.map((x) => x.title).slice(0, 3), final: "one place." },
    rapid: product.rapid || rapidFrom(f, product.steps),
    climb: product.climb || f.map((x) => x.title.replace(/[.]$/, "") + "."),
    proof: product.proof || null, reskin: product.reskin || null,
    hubSub: product.hubSub || "Everything in one place", hudLeft: product.hudLeft || brand.tagline.toUpperCase().slice(0, 28)
  };
}

