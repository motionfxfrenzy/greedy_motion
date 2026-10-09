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
