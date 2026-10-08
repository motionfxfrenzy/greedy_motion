// Pinned third-party browser builds that compositions may load from `vendor/`. One list, used by the
// creative checks and (through backend config) by the render-folder builder. Versions are pinned in
// backend/package.json; licences in third_party/creative-libraries-NOTICE.md.
import { resolve } from "node:path";

export const VENDOR = {
  "gsap.min.js": "node_modules/gsap/dist/gsap.min.js",
  "anime.umd.min.js": "node_modules/animejs/dist/bundles/anime.umd.min.js",
  "rough.js": "node_modules/roughjs/bundled/rough.js",
  "p5.min.js": "node_modules/p5/lib/p5.min.js",
  "p5.brush.js": "node_modules/p5.brush/dist/p5.brush.js"
};

export const vendorPath = (root, name) => resolve(root, VENDOR[name]);
