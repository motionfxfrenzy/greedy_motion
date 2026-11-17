// The scene check for props that rest in the set (kit.txt K.prop). It runs a scene's draw() in Node against a RECORDING canvas (nothing is rendered) at a few
// frames and reports what would float:
//  - drawing that the scene's own code does on the screen, outside any picture fixed to the set (a prop painted straight onto the frame does not move with the
//    set under the camera, so it floats and drifts: the owner's "box with a blue light in mid-air");
//  - the kit's own prop and shape helpers (K.crate ...) called straight on the screen instead of inside K.prop / K.at / a puppet's callbacks;
//  - a resting K.prop whose floor is not on the floor of the set, or that moves in the set without `moving` / `airborne`.
// A flagged scene goes back to the author for the one repair round every pack check gets (plates/author.ts). The probe never throws: when it cannot run a
// scene it reports nothing (the bundle build and the browser check still guard the scene).
import { transformSync } from "esbuild";
import { type FilmProps, type PropPlan, propVersionForBeat, propsNamedBy } from "../../../plates/film-props.ts";

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

export type PropProbe = { raw: { frame: number; ops: Record<string, number> }[]; /** Kit drawing helpers the scene called outside any anchored call, by name. */ kitRaw: Record<string, number>; props: any[]; puppets: any[]; frames: number[]; errors: string[] };

/** Kit helpers that paint in the CURRENT drawing space: legal only inside K.prop's draw, K.at's callback or a puppet's front/behind/top. */
const KIT_PAINTERS = ["crate", "pole", "pan", "tool", "wheelbarrow", "drawPuppet", "drawPiggyback", "drawHead", "shape"] as const;

/** Runs the scene at a few frames against the recording canvas and returns what it did. Null when the scene cannot be run here. */
export function probeScene(code: string, kitSource: string, options: { frames?: number[]; width?: number; height?: number; propsCode?: string } = {}): PropProbe | null {
  try {
    const kit = kitJs(kitSource);
    const propsJs = options.propsCode ? transformSync(options.propsCode, { loader: "ts", target: "es2020" }).code : "";
    const K = new Function(`${kit}\n;${propsJs}\n;return K;\n//# sourceURL=hr-kit.js`)();
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
      try { draw(ctx, frame, env); } catch (error) { const message = String((error as Error)?.message ?? error); if (/^K\.prop/.test(message)) errors.push(message); else { if (process.env.PROP_CHECK_DEBUG) console.error("prop check: frame", frame, error); return errors.length ? { raw, kitRaw, props: K.propLog(env), puppets: K.puppetLog(env), frames, errors } : null; } }
      if (Object.keys(ops).length) raw.push({ frame, ops });
    }
    return { raw, kitRaw, props: K.propLog(env), puppets: K.puppetLog(env), frames, errors };
  } catch (error) {
    if (process.env.PROP_CHECK_DEBUG) console.error("prop check could not run:", error);
    return null;
  }
}

/** The floor of a set picture: puppets and props rest on y >= this fraction of the set height (the bottom third is flat ground). */
export const FLOOR_FROM = 0.58;
const MOVE_TOLERANCE = 3;

/** The messages for the author (empty = the scene is fine). */
export function scenePropIssues(code: string, kitSource: string, film: { filmProps?: Pick<FilmProps, "plan" | "code"> | null; beat?: { line?: string | null; visual?: string | null; keyword?: string | null }; beatIndex?: number; aspect?: string } = {}): string[] {
  const size = film.aspect === "16:9" ? { width: 1920, height: 1080 } : film.aspect === "1:1" ? { width: 1080, height: 1080 } : { width: 1080, height: 1920 };
  const probe = probeScene(code, kitSource, { ...size, ...(film.filmProps?.code ? { propsCode: film.filmProps.code } : {}) });
  if (!probe) return [];
  const out: string[] = [...probe.errors];
  if (probe.raw.length) {
    const first = probe.raw[0]!;
    const what = Object.entries(first.ops).map(([op, n]) => `${op} x${n}`).join(", ");
    out.push(`Frame ${first.frame}: the scene paints straight onto the screen (${what}) outside any picture fixed to the set. A prop drawn like that does not move with the set under the camera: it floats and drifts. Put every prop IN the set with K.prop(g, cam, { name, x, y: <floor y under it>, on: "ground" | "bench" | "table" | "counter" | "shelf" | <height>, draw: (c) => ... }) and paint only inside its draw(c) (bottom centre at 0, 0); people go through K.puppet, effects through the kit's own K.mist / K.motes / K.burst / K.popLines.`);
  }
  const kitNames = Object.entries(probe.kitRaw);
  if (kitNames.length) out.push(`The scene calls ${kitNames.map(([n]) => `K.${n}(...)`).join(", ")} straight on the screen (outside K.prop, K.at and a puppet's front/behind callbacks): that picture does not move with the set under the camera, so it floats and drifts. Stand it in the set with K.prop(g, cam, { name, x, y: <floor y under it>, on, draw: (c) => ${kitNames[0]![0] === "crate" ? "K.crate(c, 0, 0, w, h)" : "..."} }).`);
  // recurring props of the film: one object in every scene (plates/film-props.ts)
  if (film.filmProps) {
    if (/\bK\.defineProp\b/.test(code)) out.push("Do not define props in the scene: K.defineProp belongs to the film's shared props module. Call the shared prop by id: K.prop(g, cam, { use: \"<id>\", version, x, y, on }).");
    const named = propsNamedBy(film.beat, film.filmProps.plan);
    const index = film.beatIndex ?? 0;
    for (const prop of named) {
      const version = propVersionForBeat(prop, index);
      const used = probe.props.filter((r) => r.use === prop.id);
      const own = probe.props.filter((r) => r.use === null && (r.name === prop.id || prop.aliases.includes(String(r.name).toLowerCase())));
      if (!used.length) out.push(`This scene shows the film's recurring prop "${prop.id}" (${prop.name}) but does not use the shared drawing${own.length ? " (it draws its own)" : ""}. A recurring object must look identical in every scene: remove your own drawing and call K.prop(g, cam, { use: "${prop.id}", version: "${version}", x, y: <floor y>, on: "ground" | "bench" | ... }).`);
      else if (used.some((r) => String(r.version) !== version)) out.push(`The scene uses version "${used.find((r) => String(r.version) !== version)!.version}" of "${prop.id}" but the script shows version "${version}" here (${prop.versions.find((v) => v.version === version)?.description.slice(0, 80)}). Use version: "${version}".`);
    }
    for (const r of probe.props) if (r.use === null && film.filmProps.plan.props.some((p) => p.id === r.name || p.aliases.includes(String(r.name).toLowerCase())) && !named.some((p) => p.id === r.name || p.aliases.includes(String(r.name).toLowerCase()))) out.push(`Prop "${r.name}" is a recurring prop of the film: use the shared drawing (K.prop with use: "${film.filmProps.plan.props.find((p) => p.id === r.name || p.aliases.includes(String(r.name).toLowerCase()))!.id}"), never your own.`);
  }
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
  if (!film.aspect || film.aspect === "9:16") out.push(...captionBandIssues(probe));
  return out;
}

/** Vertical shorts: faces and key props stay above this fraction of the frame height; the bottom quarter is the caption band. */
export const CAPTION_LIMIT = 0.75;
/** A figure or prop is flagged when it sits in the band in at least this share of the probed frames. */
export const BAND_SHARE = 0.6;

/** The main figure's face, and any key prop, in the bottom quarter for most of the shot (the captions and the platform's buttons cover it). */
export function captionBandIssues(probe: PropProbe): string[] {
  const out: string[] = [];
  const total = Math.max(1, probe.frames.length);
  // the main figure of each frame is the biggest puppet on the screen
  const main = new Map<number, any>();
  for (const p of probe.puppets) if (!main.has(p.frame) || p.size > main.get(p.frame).size) main.set(p.frame, p);
  const low = [...main.values()].filter((p) => p.face > CAPTION_LIMIT);
  if (main.size && low.length / main.size >= BAND_SHARE) {
    const at = Math.round((low.reduce((a, p) => a + p.face, 0) / low.length) * 100);
    out.push(`In ${low.length} of ${main.size} probed frames the main figure's face is at ${at}% of the frame height, inside the bottom quarter. Vertical shorts put captions (and the platform's buttons) over the bottom 25%: faces, the main action and key props must sit ABOVE 75% of the frame height; only the ground may run on below. Stand the figures on K.floorLine(cam) (the plate y that appears at 70% of the frame height) or move the camera down so the face rises above the band.`);
  }
  const byName = new Map<string, any[]>();
  for (const r of probe.props) if (typeof r.top === "number") byName.set(r.name, [...(byName.get(r.name) ?? []), r]);
  for (const [name, records] of byName) {
    const inBand = records.filter((r) => (r.top + r.bottom) / 2 > CAPTION_LIMIT);
    if (records.length && inBand.length / records.length >= BAND_SHARE) {
      out.push(`Prop "${name}" sits in the bottom quarter of the frame (its centre at ${Math.round((inBand.reduce((a, r) => a + (r.top + r.bottom) / 2, 0) / inBand.length) * 100)}% of the frame height) in ${inBand.length} of ${records.length} placements: the captions cover it. Put a key prop above 75% of the frame height (higher on its surface, or move the camera down); the ground may run on below.`);
    }
  }
  void total;
  return out;
}

/**
 * The film's shared props module must run: every planned prop is defined with every version, and each drawing paints something without throwing. Returns the
 * problems for the model's one repair round (empty = fine).
 */
export function probePropsModule(code: string, kitSource: string, plan: PropPlan): string[] {
  const out: string[] = [];
  try {
    const kit = kitJs(kitSource);
    const js = transformSync(code, { loader: "ts", target: "es2020" }).code;
    let ops = 0;
    const K = new Function(`${kit}\n;${js}\n;return K;\n//# sourceURL=hr-kit.js`)();
    const ctx = fakeCtx(() => { ops += 1; });
    for (const prop of plan.props) {
      const def = K.PROP_DEFS[prop.id];
      if (!def) { out.push(`K.defineProp("${prop.id}", ...) is missing.`); continue; }
      for (const v of prop.versions) {
        const draw = def.versions?.[v.version];
        if (typeof draw !== "function") { out.push(`Prop "${prop.id}" has no version "${v.version}" (${v.description.slice(0, 60)}).`); continue; }
        for (const s of [{ version: v.version, t: 0, active: 0 }, { version: v.version, t: 1.3, active: 1 }]) {
          ops = 0;
          try { draw(ctx, s); } catch (error) { out.push(`Prop "${prop.id}" version "${v.version}" throws: ${String((error as Error)?.message ?? error).slice(0, 160)}`); break; }
          if (ops < 2) { out.push(`Prop "${prop.id}" version "${v.version}" paints almost nothing (${ops} fills/strokes): draw the whole object.`); break; }
        }
      }
    }
  } catch (error) {
    out.push(`The props module does not run: ${String((error as Error)?.message ?? error).slice(0, 200)}`);
  }
  return out;
}
