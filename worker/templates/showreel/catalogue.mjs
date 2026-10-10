// MODULE CATALOGUE: every scene module the engine can draw, how long it needs, which product facts it needs, and where it comes from.
// A module is one file in scenes/<name>.js (it registers S["<name>"] = (c) => {...}); a transition is one file in transitions/<name>.js.
// To add a scene: write scenes/<name>.js, add its row here, add it to the pools of the personalities that should use it, add its copy
// defaults in copy.mjs and its sounds in sound.mjs. docs/SHOWREEL_MODULES.md has the checklist.
export const MODULES = {
  "hook-type": { sec: [2.4, 4], needs: ["prompt"], role: "open", from: "both benchmarks: the product's own action, typed", desc: "A request typed into a composer, send pressed." },
  "hook-kinetic": { sec: [1.6, 3.2], needs: ["hook"], role: "open", from: "general craft", desc: "Two big kinetic lines rising from a mask, optional kicker." },
  "pill-cycle": { sec: [2.4, 3.4], needs: ["cycle"], role: "open", from: "benchmark A 0.0-2.8 s", desc: "A selected pill cycles words fast and lands on the claim." },
  "app-fill": { sec: [2.8, 4.6], needs: ["rows", "stat"], role: "mid", from: "benchmark B", desc: "The app window fills up: rows, statuses flip, a counter." },
  "field-3d": { sec: [2, 3.4], needs: ["icons"], role: "mid", from: "benchmark B 9.4-11.2 s", desc: "Tilted field of screens and drifting icons, camera glide." },
  "wall-zoom": { sec: [2.2, 3.6], needs: [], role: "mid", from: "benchmark A 5.6-7.2 s", desc: "Land on one card, pull back to a wall of them." },
  "lines-stack": { sec: [2.6, 4.6], needs: ["lines"], role: "mid", from: "general craft", desc: "Big lines one after another, the last keeps pushing." },
  "lines-climb": { sec: [2.4, 3.8], needs: ["climb"], role: "mid", from: "benchmark B 11.4-12.8 s", desc: "Lines that grow, each dims the one before; optional proof badges." },
  "stat-hero": { sec: [1.8, 3], needs: ["stat"], role: "mid", from: "general craft", desc: "One giant number counting up, a label, a bar." },
  "trio-cards": { sec: [2.4, 3.8], needs: ["features"], role: "mid", from: "general craft", desc: "Three feature cards pop or slide in." },
  "hub-orbit": { sec: [2.4, 3.8], needs: ["features"], role: "mid", from: "benchmark A 7.6-9.2 s", desc: "The product at the centre, features orbiting on a ring." },
  "split-compare": { sec: [2.4, 3.8], needs: ["before", "after"], role: "mid", from: "general craft", desc: "Before / after, a divider wipes across." },
  "chat-demo": { sec: [3, 4.6], needs: ["chat"], role: "mid", from: "benchmark A 3.0-5.0 s", desc: "Ask, the answer types, an action chip appears." },
  "step-path": { sec: [3.6, 5.2], needs: ["steps"], role: "mid", from: "explainer research", desc: "Numbered steps along a drawn path, a cursor travels." },
  "rapid-fire": { sec: [2.4, 4.2], needs: ["rapid"], role: "mid", from: "benchmark B 6.6-9.4 s", desc: "One layout, a new tilted card every beat, hard cuts." },
  "reskin-proof": { sec: [2.6, 3.8], needs: ["reskin"], role: "mid", from: "benchmark A 9.4-11.8 s", desc: "One window re-skinned 3-4 times; accent words follow." },
  "end-burst": { sec: [3.2, 4], needs: [], role: "end", from: "benchmark A 12.0-15.0 s", desc: "Flood, shards, mark, typed-feel name, tagline, URL pill." },
  "end-sting": { sec: [2.8, 4], needs: [], role: "end", from: "benchmark B 13.0-15.0 s", desc: "Dip to black, rings, mark pop, typed wordmark, URL pill." },
  "end-calm": { sec: [3, 4.2], needs: [], role: "end", from: "calm research", desc: "Bloom, mark, name, tagline, soft URL pill." },
  "end-cta": { sec: [3, 4.2], needs: ["recap", "cta"], role: "end", from: "explainer research", desc: "Recap ticks, a call-to-action button, logo line." }
};
export const TRANSITIONS = {
  "cut": "hard cut on the beat", "whip-x": "horizontal whip with blur", "whip-y": "vertical whip with blur", "push": "next scene pushes the last aside",
  "iris": "circle opens from the centre", "zoom-through": "dive through the scene with blur", "flood": "accent circle floods the frame", "cover-wipe": "skewed panel covers"
};
export const has = (product, needs) => needs.every((k) => (Array.isArray(product[k]) ? product[k].length : product[k]));
