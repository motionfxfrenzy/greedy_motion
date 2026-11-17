// The browser half of the storyboard cards: the beat's set with the pack's own puppets drawn on it by THE FILM'S KIT (packs/<id>/kit.txt, served
// transpiled by GET /v1/storyboard-kit/<id>): K.set for the picture, K.puppet for the cast (rig, three views, pose library, contact shadow) and
// K.actors for the same warm grade the film uses. No model call. Deterministic: the same plan and set picture always give the same card.
import type { CardPlan, Mood, PoseName } from "./cast";

/** The kit's global K (backend/src/plan/packs/history-reel/kit.txt). Typed loosely: it is our own code, run as it is. */
export type Kit = any;

/** Evaluates the transpiled kit once. The kit is pure (no clock, no Math.random, no network): everything comes from its arguments. */
export function loadKit(js: string): Kit {
  // the 2D path of K.set: one canvas per card instead of a shared WebGL context
  (globalThis as { __HR_NO_GL__?: boolean }).__HR_NO_GL__ = true;
  return new Function(`${js}\n;return K;`)();
}

export type CardAspect = "9:16" | "16:9" | "1:1";
const SIZE: Record<CardAspect, { w: number; h: number }> = { "9:16": { w: 1080, h: 1920 }, "16:9": { w: 1080, h: 608 }, "1:1": { w: 1080, h: 1080 } };
/** The data URL is a JPEG this wide (cards are small; this keeps a card near 25 KB). */
export const CARD_OUT_WIDTH = 540;

/** Where the cast stands in the set, from the kit's own rules: feet on the flat ground (the lower third), the hero 35-55% of the frame height. */
export const LAYOUT = { feetAt: 0.8, heroHeight: 0.44, extraHeight: 0.3, extraFeetAt: 0.775, captionHeight: 0.07 } as const;

function pose(K: Kit, name: PoseName, cast: any, mood: Mood): any {
  const face2 = { ...(K.FACE[mood === "calm" ? "calm" : mood === "grin" ? "grin" : mood === "scared" ? "scared" : mood === "angry" ? "angry" : "wow"]) };
  switch (name) {
    case "walk": return { ...K.pose.walk(cast, 0.18, "side"), face2 };
    case "holdOut": return { ...K.pose.holdOut(cast, "three"), face2 };
    case "pointUp": return { ...K.pose.pointUp(cast), face2 };
    case "push": return { ...K.pose.push(cast, "side"), face2 };
    case "sit": return { ...K.pose.sit(cast, -64, "side"), face2 };
    default: return { ...K.pose.stand(cast, "three"), face2 };
  }
}

export type CardInput = {
  kit: Kit;
  /** The set picture (an <img> or an ImageBitmap) and the set's name without "set-" (the kit reads it as `set-<place>`). */
  setImage: { width: number; height: number } & CanvasImageSource;
  place: string;
  aspect: CardAspect;
  plan: CardPlan;
  /** The beat's key phrase, written small along the bottom (this is the storyboard's preview, not the film: the film draws no words). */
  caption?: string | null;
};

/** One card as a JPEG data URL. */
export function drawCard(input: CardInput): string {
  const { kit: K, setImage, place, aspect, plan } = input;
  const { w: W, h: H } = SIZE[aspect];
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const make = (w: number, h: number) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return { canvas: c, ctx: c.getContext("2d")! }; };
  const env: any = { W, H, scale: 1, canvas: make, cache: new Map(), image: (name: string) => (name === `set-${place}` ? setImage : undefined) };
  const PH = K.PW * (setImage.height || 1) / (setImage.width || 1);
  const feetY = LAYOUT.feetAt * PH;
  // look at the set so the ground sits in the lower part of the frame (the kit keeps the view inside the picture)
  const cam = K.camera(0, [[0, { x: K.PW / 2, y: feetY - 0.3 * H }]], { push: false });
  K.set(ctx, env, cam, place);

  const viewH = H / (cam.z || 1), viewW = W / (cam.z || 1);
  // each named person has one seeded look for the whole film; the crowd is generic (seeded by the place, so it is stable too) and stays smaller and behind
  const named = plan.figures.map((f) => K.crowdCast(1, f.seed)[0]);
  const crowd = plan.crowd ? K.crowdCast(plan.crowd, plan.crowdSeed) : [];
  K.actors(ctx, env, cam, (g: any) => {
    // far ones first: the crowd, then the named figures in front
    const crowdXs = plan.figures.length ? [-0.31, 0.31] : [-0.27, 0.02, 0.29];
    crowd.forEach((cast: any, i: number) => {
      const x = cam.x + (crowdXs[i % crowdXs.length] ?? 0) * viewW, h = (plan.figures.length ? LAYOUT.extraHeight : LAYOUT.extraHeight + 0.04 * (i % 2)) * viewH;
      K.puppet(g, cam, cast, x, LAYOUT.extraFeetAt * PH + (i % 2) * 0.01 * PH, h, { ...K.pose.stand(cast, "three"), face: x < cam.x ? 1 : -1, face2: K.FACE[plan.figures.length ? "wow" : "calm"] }, { shadow: true, sun: "left" });
    });
    named.forEach((cast: any, i: number) => {
      const spread = named.length === 2 ? (i === 0 ? -0.16 : 0.16) : 0;
      const p = i === 0 ? pose(K, plan.pose, cast, plan.mood) : { ...K.pose.stand(cast, "three"), face: -1, face2: K.FACE.calm };
      const opts: any = { shadow: true, sun: "left" };
      if (i === 0 && plan.pose === "sit") opts.behind = (c2: any) => K.crate(c2, 24, 0, 170, 64);
      K.puppet(g, cam, cast, cam.x + spread * viewW, feetY, LAYOUT.heroHeight * viewH, p, opts);
    });
  });

  if (input.caption) {
    const text = input.caption.slice(0, 40), bh = Math.round(LAYOUT.captionHeight * H), fs = Math.round(bh * 0.5);
    ctx.save();
    ctx.font = `700 ${fs}px system-ui, -apple-system, sans-serif`;
    const tw = Math.min(W * 0.92, ctx.measureText(text).width + fs * 1.6);
    ctx.fillStyle = "rgba(12,14,22,0.72)";
    ctx.beginPath(); ctx.roundRect((W - tw) / 2, H - bh * 1.5, tw, bh, bh / 2); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text, W / 2, H - bh * 1.5 + bh / 2 + 1, tw - fs);
    ctx.restore();
  }

  const out = document.createElement("canvas");
  out.width = CARD_OUT_WIDTH; out.height = Math.round(CARD_OUT_WIDTH * H / W);
  out.getContext("2d")!.drawImage(canvas, 0, 0, out.width, out.height);
  return out.toDataURL("image/jpeg", 0.74);
}
