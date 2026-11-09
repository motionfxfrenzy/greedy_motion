import { Gfx, type Ctx, type Env, type Medium, type P } from "./core";
import type { Film } from "./film";
import { mix, smooth } from "./gallery";
import { bee, rose } from "./scrapbookEngraving";
import { clamp01, easeOut, engrave, fibres, path, rect, shadowOf, staged, tear, type Step } from "./scrapbookKit";

const INK = "#2a2019", REDPEN = "#c23a2a", PARCH = "#e8d6b2";
const PEN: Medium = { nib: 1, taper: 0.35, pressure: 0.35, retrace: false, wobble: 0.5, rough: 0.35 };
const N = 150;

const draw = (ctx: Ctx, frame: number, env: Env) => {
  ctx.setTransform(env.scale, 0, 0, env.scale, 0, 0);
  ctx.fillStyle = PARCH;
  ctx.fillRect(0, 0, 1920, 1080);
  const g = new Gfx(ctx, env, 0, PEN);
  const sh = tear(rect(1060, 720, 960, 540), 2.6, 11);
  shadowOf(g, [sh], [2.5, 4], 5, 0.34);
  ctx.fillStyle = mix("#f2eadb", "#7a5a30", 0.05);
  path(ctx, sh);
  ctx.fill();
  fibres(ctx, sh, "#f2eadb", 16, 0.8, 0.28);
  const b = bee(720, 520, 28, 1.1);
  const r = rose(1220, 520, 84);
  const p = easeOut(clamp01(frame / N));
  engrave(ctx, b.passes[0]!, p, INK);
  engrave(ctx, r.passes[0]!, p, INK);
  const arc = smooth([[780, 420], [960, 340], [1140, 420]] as P[], false, 8);
  g.pen(arc, { w: 2, color: REDPEN, seed: 97, wobble: 0.5, boil: 0, taper: 0.4, retrace: false, progress: p });
  g.paper("paper", 0.1);
};

const steps: Step[] = [{ id: "card", start: 0, end: N, draw: (c, e, p, f) => { void p; draw(c, f, e); } }];
const run = staged("clean-specimen", steps);

export const film: Film = {
  meta: { title: "Clean Specimen Card", W: 1920, H: 1080, fps: 30, bpm: 120, durationFrames: N },
  assets: { images: {} },
  shots: [{ id: "scene", start: 0, end: N, draw: (ctx, f, env) => run(ctx, f, env) }]
};
