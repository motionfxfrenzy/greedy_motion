export const FPS: number;
export type ClipFacts = { codec?: string; width?: number; height?: number; pixFmt?: string; fps?: number; frames?: number };
export function canStreamCopy(facts: ClipFacts[], timelineFrames: number[], size: { w: number; h: number }, overlays: number): boolean;
