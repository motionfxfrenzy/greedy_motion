import type { LookId } from "./looks.ts";

export type VisualAsset = { file: string; sha256: string; mime: "image/png" | "video/mp4"; duration?: number };
export type VisualShot = {
  beatId: string;
  keyframe?: VisualAsset;
  assemblySheet?: VisualAsset;
  startFrame?: VisualAsset;
  clip?: VisualAsset;
  /** Saved immediately after submission so a worker restart resumes polling, never re-submits. */
  operation?: string;
  pending?: "image" | "assembly" | "video";
  terminalError?: string;
};
export type PlanVisuals = {
  runId: string;
  fingerprint: string;
  look: LookId;
  recipeVersion: number;
  status: "queued" | "generating" | "ready" | "failed";
  budgetUsd: number;
  reservedUsd: number;
  imageModel: string;
  videoModel: string;
  styleKey?: VisualAsset;
  stylePending?: boolean;
  shots: Record<string, VisualShot>;
  error?: string;
  updatedAt: string;
  worker?: { token: string; expiresAt: number };
  history?: Omit<PlanVisuals, "history">[];
  reconciliations?: { at: string; action: string; shot?: string; evidence: string; previous: string }[];
};
export type VisualStatus = {
  required: boolean;
  available: boolean;
  status: "not-started" | "stale" | PlanVisuals["status"];
  total: number;
  ready: number;
  estimateUsd: number;
  reservedUsd: number;
  maxBudgetUsd: number;
  error?: string;
  runId?: string;
};
