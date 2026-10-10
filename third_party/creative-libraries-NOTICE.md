# Creative libraries: notices

Browser libraries that compositions load. Versions are pinned in `backend/package.json` (exact for the new libraries); the files are copied
from `node_modules` (see `scripts/creative-vendor.mjs`) or inlined by `worker/templates/beat-plan/build.mjs`.
They are shipped unmodified.

| Library | Version | Licence | Used by | How it ships |
| --- | --- | --- | --- | --- |
| GSAP | 3.14.x (`^3.14.2`) | GSAP Standard "No Charge" licence | every composition (default runtime) | `vendor/gsap.min.js` |
| Rough.js (Preet Shihn) | 4.6.6 | MIT | Sketch look in the beat-plan engine; `rough-sketch` spike | inlined in `worker/templates/beat-plan/index.html` (`<script id="bp-rough">`); `vendor/rough.js` in the spike |
| Anime.js (Julian Garnier) | 4.5.0 | MIT | `anime-motion-path` spike (not yet used by the engine) | `vendor/anime.umd.min.js` |
| p5.js | 2.3.4 | **LGPL-2.1** | `p5-brush` spike (not yet used by the engine) | `vendor/p5.min.js`, unmodified, as a separate file |
| p5.brush (Alejandro Campos) | 2.2.3 | MIT | `p5-brush` spike | `vendor/p5.brush.js` |

LGPL note for p5.js: it may be shipped unmodified as its own file with this notice and its licence text; if we ever
modify p5.js itself, the modified source must be offered under the LGPL. Do not bundle it into our own minified code.
Full licence texts are in each package under `node_modules/<package>/` (`LICENSE` / `license.txt`).
