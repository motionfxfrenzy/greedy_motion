/** Static advisory only. The API image has no Chromium or project asset workspace for the
 * release-time pixel comparison. A clean result does not establish deterministic seeking. */
export function seekWarnings(html: string): string[] {
  const warnings = ["Seek safety was checked statically only; forward/reverse frame equivalence was not verified."];
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  let flips = 0;
  for (const [, script] of scripts) {
    // A .set may be an initial state or a safe object setter: deliberately warn, never reject.
    flips += [...script!.matchAll(/\b(?:tl|timeline|gsap)\s*\.\s*set\s*\(/g)].length;
  }
  if (flips) warnings.push(`${flips} bare GSAP set call(s) may retain state during backward seeks. Use explicit from/to states and run the release seek-safety gate.`);
  return warnings;
}

/**
 * Static advisory against the house craft rules (gm-skill-authoring/references/shared-craft.md, the same file the hosted author
 * is given). It reads the proposed source, never renders it, so every finding is a "this looks like" warning the user can
 * dismiss, never a rejection; a clean result does not establish that the film is good, only that these known patterns are absent.
 */
export function craftWarnings(html: string): string[] {
  const warnings: string[] = [];
  const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join("\n");
  const style = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
  const statements = script.split(";");
  if (/\b(?:Math\.random|Date\.now|performance\.now|requestAnimationFrame|setTimeout|setInterval)\s*\(|new Date\s*\(/.test(script)) warnings.push("The script reads a clock, a timer or a random number. A render seeks frames in any order, so every frame must be a function of the playhead alone (seeded arrays or the index instead of random).");
  if (/(?:^|[\s;{])transition\s*:/.test(style) || /\btransition\s*:/.test(html.replace(style, ""))) warnings.push("A CSS transition does not render deterministically. Animate it on the GSAP timeline instead.");
  if (/repeat\s*:\s*-1/.test(script)) warnings.push("An infinite repeat (repeat: -1) has no end frame. Use a finite repeat that fits the duration.");
  if (statements.some((s) => /\bopacity\b/.test(s) && /ease\s*:\s*(?:["'](?:back|elastic|bounce)[^"']*["']|spring\s*\()/.test(s))) warnings.push("An overshooting ease (back, elastic, bounce or a spring) drives opacity, which overshoots past 1 and clamps. Fade with a linear or power ease and let the spring move position or scale.");
  if (statements.some((s) => /blur\(/.test(s) && /\bopacity\b/.test(s) && /fromTo|\.from\(/.test(s))) warnings.push("A blur-in (opacity and blur together) is a template look this house avoids. Let text rise from a mask line or carry an element across instead.");
  const absolute = (style.match(/position\s*:\s*absolute/g) ?? []).length;
  if (absolute >= 3 && !/z-index\s*:/.test(style + html)) warnings.push("Several absolutely positioned layers and no z-index anywhere. Set a z-index on every layer of a scene with overlays so nothing floats above a layer it should be under.");
  if (/\b(?:scale|x|y)\s*:/.test(script) && /fromTo|\.to\(|\.from\(/.test(script) && !/gsap\.set\s*\(/.test(script)) warnings.push("Elements are moved with GSAP but none is given an explicit identity transform first (gsap.set(els, { x: 0, y: 0, scale: 1 })). Without it a frame can differ by a few pixels depending on which frames were drawn first.");
  return warnings;
}
