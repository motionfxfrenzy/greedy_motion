/** Document model shared by the Pro Editor's pure logic, stores and views. No React in here. */

export type EditorMode = "layers" | "clips";

export type LayerType = "text" | "solid" | "shape" | "null" | "adjustment" | "camera" | "light" | "image" | "precomp" | "audio";
export type LabelColor = "blue" | "violet" | "amber" | "green" | "rose" | "gray";

/** Value of an animated property: a number, or a vector such as position / scale. */
export type PropValue = number | number[];

/**
 * One keyframe. `o` / `i` are the outgoing / incoming influence in percent; `lin` marks a linear
 * (diamond) key, otherwise it is eased (circle).
 */
export type Keyframe = { t: number; v: PropValue; o: number; i: number; lin: boolean };

export type EffectParam = { n: string; v: number; u: string; st: number };
export type Effect = { id: string; name: string; on: boolean; open: boolean; params: EffectParam[] };

export type Layer = {
  id: string;
  name: string;
  type: LayerType;
  vis: boolean;
  lock: boolean;
  solo: boolean;
  inP: number;
  outP: number;
  parent: string | null;
  pos: number[];
  scale: number[];
  rot: number;
  ry: number;
  opacity: number;
  w: number;
  h: number;
  effects: Effect[];
  keys: Record<string, Keyframe[]>;
  threeD: boolean;
  label: LabelColor;
  blend: string;
  text?: string;
  font?: string;
  size?: number;
  fill?: string;
  color?: string;
  img?: string;
  src?: string;
  zoom?: number;
  dof?: boolean;
  intensity?: number;
  lcolor?: string;
  vol?: number;
};

export type ClipKind = "text" | "box" | "video" | "img" | "audio";

export type Tween = { prop: string; from: string; to: string; dur: number; ease: string; at: number };

export type Clip = {
  id: string;
  name: string;
  /** Code-generated elements get simple edits in the inspector and complex ones through the agent. */
  gen?: boolean;
  track: number;
  start: number;
  dur: number;
  kind: ClipKind;
  text: string;
  css: [string, string][];
  tweens: Tween[];
  img?: string;
  src?: string;
  vol?: number;
  fadeIn?: number;
  fadeOut?: number;
  mute?: boolean;
};

export type Marker = { t: number; label: string };
export type ReviewComment = { id: string; who: string; ini: string; at: number; text: string; resolved: boolean };

export type CheckLevel = "error" | "warning";
export type CheckIssue = { lvl: CheckLevel; id: string; msg: string; hint: string; t?: number };

export type JobState = "queued" | "running" | "done" | "failed";
export type Job = { id: string; kind: string; pct: number; state: JobState; rate: number; frames: number; err?: string; /** Finished output, for real renders. */ url?: string };

export type Box = { cx: number; cy: number; w: number; h: number; rot: number };
export type Rect = { x: number; y: number; w: number; h: number };

/** Everything the undo history covers. UI state (selection, playhead, panel sizes) is deliberately absent. */
export type EditorDoc = {
  layers: Layer[];
  /** HTML clips mode: the HyperFrames composition source. The clip list is derived from it. */
  html: string;
  markers: Marker[];
  workArea: [number, number];
  comments: ReviewComment[];
  vars: Record<string, boolean>;
};

export type Canvas = { width: number; height: number };
