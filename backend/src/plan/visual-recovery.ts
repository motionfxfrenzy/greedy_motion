import type { PlanVisuals } from "@videosaas/contracts";

export type VisualRecovery = { runId: string; shot?: string; action: "attach-operation" | "release-unsubmitted" | "replace-terminal"; operation?: string; evidence: string };
/** Operator-only mutation. No provider calls, queue submission, or reservation refunds. */
export function reconcileVisuals(current: PlanVisuals | undefined, input: VisualRecovery, now = Date.now()): PlanVisuals {
  if (!current) throw new Error("No material run exists.");
  const state = structuredClone(current);
  const run = state.runId === input.runId ? state : state.history?.find(r => r.runId === input.runId);
  if (!run) throw new Error("Run ID does not match an existing attempt.");
  if (run.worker && run.worker.expiresAt > now) throw new Error("An active worker owns this run.");
  if (!input.evidence.trim()) throw new Error("Provider evidence or proof of no submission is required.");
  const shot = input.shot ? run.shots[input.shot] : undefined;
  if (input.shot && !shot) throw new Error("Unknown shot.");
  const previous = JSON.stringify(shot ?? { styleKey: run.styleKey, stylePending: run.stylePending });
  if (input.action === "attach-operation") {
    if (shot?.pending !== "video" || !input.operation?.match(/^models\/[^\s]+\/operations\/[^\s]+$/)) throw new Error("A pending video and a full provider operation name are required.");
    shot.operation = input.operation; delete shot.pending;
  } else if (input.action === "release-unsubmitted") {
    if (shot) { if (!shot.pending) throw new Error("Shot is not pending."); delete shot.pending; }
    else { if (!run.stylePending) throw new Error("Style key is not pending."); run.stylePending = false; }
  } else if (input.action === "replace-terminal") {
    if (!shot?.terminalError || !shot.operation) throw new Error("Only a terminal video operation can be replaced.");
    delete shot.operation; delete shot.terminalError; delete shot.clip;
  } else throw new Error("Unknown recovery action.");
  run.reconciliations ??= [];
  run.reconciliations.push({ at: new Date(now).toISOString(), action: input.action, shot: input.shot, evidence: input.evidence, previous });
  run.worker = undefined; run.status = "failed"; run.error = "Operator reconciled the attempt. Resume generation explicitly.";
  return state;
}
