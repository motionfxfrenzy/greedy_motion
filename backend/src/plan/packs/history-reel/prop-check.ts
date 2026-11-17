// The scene check for props that rest in the set (kit.txt K.prop). It runs a scene's draw() in Node against a RECORDING canvas (nothing is rendered) at a few
// frames and reports what would float:
//  - drawing that the scene's own code does on the screen, outside any picture fixed to the set (a prop painted straight onto the frame does not move with the
//    set under the camera, so it floats and drifts: the owner's "box with a blue light in mid-air");
//  - the kit's own prop and shape helpers (K.crate ...) called straight on the screen instead of inside K.prop / K.at / a puppet's callbacks;
//  - a resting K.prop whose floor is not on the floor of the set, or that moves in the set without `moving` / `airborne`.
// A flagged scene goes back to the author for the one repair round every pack check gets (plates/author.ts). The probe never throws: when it cannot run a
// scene it reports nothing (the bundle build and the browser check still guard the scene).
import { transformSync } from "esbuild";

const PAINT = new Set(["fill", "stroke", "fillRect", "strokeRect", "fillText", "strokeText", "drawImage"]);
const GRADIENT = () => ({ addColorStop() {} });

type Sink = (op: string) => void;
function fakeCtx(sink: Sink): any {
  const state: Record<string, unknown> = { globalAlpha: 1, lineWidth: 1, globalCompositeOperation: "source-over" };
  return new Proxy({}, {
    get(_t, prop: string) {
      if (prop === "createLinearGradient" || prop === "createRadialGradient" || prop === "createPattern") return GRADIENT;
      if (prop === "measureText") return () => ({ width: 10 });
      if (prop === "getImageData") return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(4, Math.floor(w * h * 4))) });
      if (prop === "canvas") return { width: 1080, height: 1920 };
      if (PAINT.has(prop)) return () => sink(prop);
      if (prop in state) return state[prop];
      return () => undefined;
    },
    set(_t, prop: string, value) { state[prop] = value; return true; }
  });
}

const SCENE_FRAME = /hr-scene\.js/;
const KIT_FRAME = /hr-kit\.js/;
/** The first frame of the current call stack that belongs to the scene or to the kit: who is drawing. */
function caller(): "scene" | "kit" | "other" {
  const limit = Error.stackTraceLimit; Error.stackTraceLimit = 12;
  const stack = String(new Error().stack); Error.stackTraceLimit = limit;
  for (const line of stack.split("\n")) {
    if (SCENE_FRAME.test(line)) return "scene";
    if (KIT_FRAME.test(line)) return "kit";
  }
  return "other";
}

let kitCache: { source: string; js: string } | null = null;
const kitJs = (source: string) => (kitCache?.source === source ? kitCache.js : (kitCache = { source, js: transformSync(source, { loader: "ts", target: "es2020" }).code }).js);

export type PropProbe = { raw: { frame: number; ops: Record<string, number> }[]; /** Kit drawing helpers the scene called outside any anchored call, by name. */ kitRaw: Record<string, number>; props: any[]; errors: string[] };

/** Kit helpers that paint in the CURRENT drawing space: legal only inside K.prop's draw, K.at's callback or a puppet's front/behind/top. */
const KIT_PAINTERS = ["crate", "pole", "pan", "tool", "wheelbarrow", "drawPuppet", "drawPiggyback", "drawHead", "shape"] as const;

/** Runs the scene at a few frames against the recording canvas and returns what it did. Null when the scene cannot be run here. */
export function probeScene(code: string, kitSource: string, options: { frames?: number[]; width?: number; height?: number } = {}): PropProbe | null {
  try {
    const kit = kitJs(kitSource);
    const K = new Function(`${kit}\n;return K;\n//# sourceURL=hr-kit.js`)();
    const sceneJs = transformSync(code, { loader: "ts", format: "cjs", target: "es2020" }).code;
    const mod: { exports: any } = { exports: {} };
    const kitRaw: Record<string, number> = {};
    const Kp: any = { ...K };
    for (const name of KIT_PAINTERS) if (typeof K[name] === "function") Kp[name] = (...args: unknown[]) => { if (!K.anchored()) kitRaw[name] = (kitRaw[name] ?? 0) + 1; return (K[name] as (...a: unknown[]) => unknown)(...args); };
    new Function("exports", "K", "module", `${sceneJs}\n//# sourceURL=hr-scene.js`)(mod.exports, Kp, mod);
    const film = mod.exports.film;
    const draw = film?.shots?.[0]?.draw as ((ctx: unknown, frame: number, env: unknown) => void) | undefined;
    const total = Math.max(2, Number(film?.meta?.durationFrames ?? film?.shots?.[0]?.end ?? 60));
    if (!draw) return null;
    const frames = options.frames ?? [...new Set([0, 0.25, 0.5, 0.75, 1].map((f) => Math.min(total - 1, Math.round(f * (total - 1)))))];
    const W = options.width ?? 1080, H = options.height ?? 1920;
    const raw: PropProbe["raw"] = [];
    const errors: string[] = [];
    let ops: Record<string, number> = {};
    const sink: Sink = (op) => { if (!K.anchored() && caller() === "scene") ops[op] = (ops[op] ?? 0) + 1; };
    const ctx = fakeCtx(sink);
    const env: any = {
      W, H, scale: 1, cache: new Map(), quality: 1,
      canvas: (w: number, h: number) => ({ canvas: { width: w, height: h }, ctx: fakeCtx(sink) }),
      image: () => ({ width: 1080, height: 1920 })
    };
    for (const frame of frames) {
      ops = {};
      try { draw(ctx, frame, env); } catch (error) { const message = String((error as Error)?.message ?? error); if (/^K\.prop/.test(message)) errors.push(message); else { if (process.env.PROP_CHECK_DEBUG) console.error("prop check: frame", frame, error); return errors.length ? { raw, kitRaw, props: K.propLog(env), errors } : null; } }
      if (Object.keys(ops).length) raw.push({ frame, ops });
    }
    return { raw, kitRaw, props: K.propLog(env), errors };
  } catch (error) {
    if (process.env.PROP_CHECK_DEBUG) console.error("prop check could not run:", error);
    return null;
  }
}

/** The floor of a set picture: puppets and props rest on y >= this fraction of the set height (the bottom third is flat ground). */
export const FLOOR_FROM = 0.58;
const MOVE_TOLERANCE = 3;

/** The messages for the author (empty = the scene is fine). */
export function scenePropIssues(code: string, kitSource: string): string[] {
  const probe = probeScene(code, kitSource);
  if (!probe) return [];
  const out: string[] = [...probe.errors];
  if (probe.raw.length) {
    const first = probe.raw[0]!;
    const what = Object.entries(first.ops).map(([op, n]) => `${op} x${n}`).join(", ");
    out.push(`Frame ${first.frame}: the scene paints straight onto the screen (${what}) outside any picture fixed to the set. A prop drawn like that does not move with the set under the camera: it floats and drifts. Put every prop IN the set with K.prop(g, cam, { name, x, y: <floor y under it>, on: "ground" | "bench" | "table" | "counter" | "shelf" | <height>, draw: (c) => ... }) and paint only inside its draw(c) (bottom centre at 0, 0); people go through K.puppet, effects through the kit's own K.mist / K.motes / K.burst / K.popLines.`);
  }
  const kitNames = Object.entries(probe.kitRaw);
  if (kitNames.length) out.push(`The scene calls ${kitNames.map(([n]) => `K.${n}(...)`).join(", ")} straight on the screen (outside K.prop, K.at and a puppet's front/behind callbacks): that picture does not move with the set under the camera, so it floats and drifts. Stand it in the set with K.prop(g, cam, { name, x, y: <floor y under it>, on, draw: (c) => ${kitNames[0]![0] === "crate" ? "K.crate(c, 0, 0, w, h)" : "..."} }).`);
  const byName = new Map<string, any[]>();
  for (const r of probe.props) byName.set(r.name, [...(byName.get(r.name) ?? []), r]);
  for (const [name, records] of byName) {
    const resting = records.filter((r) => !(r.airborne > 0));
    for (const r of resting) {
      if (r.PH && r.y / r.PH < FLOOR_FROM) { out.push(`Prop "${name}" stands at floor y ${Math.round(r.y)}, which is above the floor of the set (the floor starts near y ${Math.round(FLOOR_FROM * r.PH)}): it hangs in mid-air. Give the floor y under it (the line a puppet standing there would use, about ${Math.round(0.8 * r.PH)}) and put it on a surface (on: "bench") instead of a high y, or give it \`airborne: <lift>\` if it is thrown or flying.`); break; }
    }
    const fixed = records.filter((r) => !r.moving);
    const still = fixed.filter((r) => !(r.airborne > 0));
    if (still.length > 1) {
      const dx = Math.max(...still.map((r) => r.x)) - Math.min(...still.map((r) => r.x)), dy = Math.max(...still.map((r) => r.y + (r.surface ?? 0) * 0)) - Math.min(...still.map((r) => r.y));
      if (dx > MOVE_TOLERANCE || dy > MOVE_TOLERANCE) out.push(`Prop "${name}" rests in the set but moves (x ${Math.round(dx)}, y ${Math.round(dy)} plate px between frames). A resting prop stays where it is put: use \`moving: true\` if it is carried, pushed or dragged, or \`airborne: <lift>\` if it is thrown, falling or flying.`);
    }
  }
  return out;
}
