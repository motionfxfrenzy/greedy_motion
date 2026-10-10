// The 5-second preview plans for the gallery (scripts/build-gallery-previews.mjs). Each plan shows the template's
// device on a placeholder product, so a card says what the finished video feels like. Times are seconds in 0–5.
// Cut points follow the pacing standard: no beat is a still, the first line lands inside half a second.
const k = (keyword, on_screen, start, end, extra = {}) => ({ kind: "kinetic", keyword, on_screen, start, end, ...extra });
const ui = (keyword, on_screen, action, target, start, end, extra = {}) => ({ kind: "ui", role: "reveal", keyword, on_screen, verb: action, ui: { screen: "s1", action, target, aspect: 1.6 }, start, end, ...extra });
const title = (keyword, on_screen, start, end = 5) => ({ kind: "title", role: "cta", keyword, on_screen, start, end });

export const galleryPlans = {
  "sketch-explainer": { brand: "Ledgerly", poster: 2.9, beats: [ui("Find the stuck approval", "Circle it, then act", "select", "Approval row", 0, 1.8, { role: "hook" }), ui("Approve in one click", "Every approval, one queue", "click", "Approve button", 1.8, 3.7), title("Ledgerly", "See the queue", 3.7)] },
  "hairline-editorial": { brand: "Atlas", poster: 2.6, beats: [k("Designs drift", "Team by team, file by file", 0, 1.8), k("One source of truth", "Components that stay in sync", 1.8, 3.7), title("Atlas", "See it in motion", 3.7)] },
  "doodle-walkthrough": { brand: "Tidyslot", poster: 2.9, beats: [k("Three simple steps", "Pick, share, done", 0, 1.7, { energy: "high" }), ui("Share your booking link", "Bookings appear in your calendar", "click", "Copy link", 1.7, 3.8), title("Tidyslot", "Try it free", 3.8)] },

  // Remakes of explainer prompts from the awesome-opus collection and the motion-prompt gallery.
  "narrated-product-minute": { brand: "Sotto", poster: 2.8, beats: [k("Read more, remember more", "A reading app that helps it stick", 0, 1.8), ui("Highlight what matters", "Notes surface when you need them", "select", "Highlighted text", 1.8, 3.7), title("Sotto", "Start reading", 3.7)] },
  "whiteboard-concept": { brand: "Concept", poster: 2.6, beats: [k("What is replica symmetry?", "Drawn out, one idea at a time", 0, 1.8), k("Many answers, one system", "Same rules, different states", 1.8, 3.6), title("Now you see it", "Draw it, then say it", 3.6)] },
  "decision-story": { brand: "Case study", poster: 2.7, beats: [k("The problem was trust", "People abandoned checkout", 0, 1.8), k("So we changed one decision", "Show the total up front", 1.8, 3.6), title("Checkout, redesigned", "What we learned", 3.6)] },
};
