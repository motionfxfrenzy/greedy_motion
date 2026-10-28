import { createHash } from "node:crypto";
import type { VideoProject } from "@videosaas/contracts";

/**
 * What a storyboard film is made from. Render is charged for exactly this: if any of it changes between the press of
 * Render and the moment the job queues the renderer, the job stops (and refunds) rather than export a different film
 * under the first one's charge and length. Motion directed during preparation (filmMotion), generated visuals and
 * bookkeeping (state, render pointer, timestamps, comments, cover) are not inputs the person edits, so they are left out.
 */
const FILM_INPUTS = ["request", "brief", "beatPlan", "planAudio", "scriptFrames", "screenshots", "site", "studio", "pro", "visualBrandSignature"] as const;

/** JSON with object keys sorted, so equal content always gives equal text. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function filmInputsHash(project: VideoProject): string {
  const inputs = Object.fromEntries(FILM_INPUTS.map((key) => [key, project[key]]));
  return createHash("sha256").update(stable(inputs)).digest("hex");
}
