import type { ReactNode, RefObject } from "react";

export type WorkspaceAspect = "16:9" | "9:16" | "1:1";
export type WorkspaceSubtitleMode = "none" | "key-phrases" | "full";
export type WorkspaceSubtitleStyle = "pill" | "cinema" | "kinetic" | "paper" | "blueprint";
export type WorkspaceAudioTrackId = "voice" | "music" | "sfx" | "transitions";
export type WorkspacePreviewQuality = 0.2 | 0.4 | 0.6;

export type WorkspaceSceneTabVisualState = "ready" | "updating" | "needs-update";

export interface WorkspaceSceneSpan {
  index: number;
  start: number;
  end: number;
  duration: number;
}

export interface WorkspaceSceneTab {
  index: number;
  keyword: string;
  duration: number;
  /** Engine or normalized state (e.g. "ready" | "updating" | "needs-update" or "drawn" | "rendering" | "failed"). */
  state: string;
  /** Human-readable status label for the tab tooltip (e.g. "Drawn", "Drawing", "Failed"). */
  stateLabel?: string;
  /** Optional class override to preserve exact styling for engine sub-states. */
  stateClassName?: string;
  error?: string;
}

export interface WorkspaceComment {
  id: string;
  at: number;
  scene: number;
  sceneAt?: number;
  body: string;
  /** Applied change description (e.g. "changed colour" or "re-laid out the scene"). */
  appliedLabel?: string;
  /** Applied scope ("element" | "scene"). */
  appliedScope?: "element" | "scene";
  /** Target element id when an element-scoped edit was applied (used for undo). */
  appliedEl?: string;
  /** Plain refusal reason when an edit was refused by the server (comment stays unapplied). */
  refusedReason?: string;
}

export interface WorkspaceOptionsConfig {
  /** Which audio track toggles the engine supports. Empty array hides the Audio tab entirely. */
  audioTracks?: readonly WorkspaceAudioTrackId[];
  /** Which subtitle modes the engine supports. Empty array hides the Subtitle tab entirely. */
  subtitleModes?: readonly WorkspaceSubtitleMode[];
  /** Whether the engine supports visual subtitle style presets. */
  subtitleStyle?: boolean;
  /** Whether the engine supports the subtitle font-size stepper. */
  subtitleSize?: boolean;
  /** Whether the engine supports custom text/box subtitle colors. */
  subtitleColors?: boolean;
  /** Whether the engine supports subtitle opacity/transparency. */
  subtitleOpacity?: boolean;
  /** Whether the engine supports per-scene subtitle positioning. */
  subtitlePosition?: boolean;
  /** Whether the engine supports stored frame preview quality (Low / Standard / High). */
  previewQuality?: boolean;
}

export interface ResolvedWorkspaceOptions {
  showAudioTab: boolean;
  audioTracks: readonly WorkspaceAudioTrackId[];
  showSubtitleTab: boolean;
  subtitleModes: readonly WorkspaceSubtitleMode[];
  subtitleStyle: boolean;
  subtitleSize: boolean;
  subtitleColors: boolean;
  subtitleOpacity: boolean;
  subtitlePosition: boolean;
  previewQuality: boolean;
}

export interface WorkspaceAudioControlState {
  voice: boolean;
  music: boolean;
  sfx: boolean;
  transitions: boolean;
  onToggleVoice: () => void;
  onToggleMusic: () => void;
  onToggleSfx: () => void;
  onToggleTransitions: () => void;
}

export interface WorkspaceSubtitleControlState {
  mode: WorkspaceSubtitleMode;
  style: WorkspaceSubtitleStyle;
  size: number;
  opacity: number;
  textColor: string;
  bgColor: string;
  effectiveTextColor: string;
  effectiveBgColor: string;
  position: { x: number; y: number };
  currentSceneIndex: number;
  onSelectMode: (mode: WorkspaceSubtitleMode) => void;
  onSelectStyle: (style: WorkspaceSubtitleStyle) => void;
  onStepSize: (delta: number) => void;
  onChangeTextColor: (hex: string) => void;
  onChangeBgColor: (hex: string) => void;
  onChangeOpacity: (opacity: number) => void;
  onChangeScenePosition: (sceneIndex: number, pos: { x: number; y: number }) => void;
  onApplyPositionToAll: (pos: { x: number; y: number }) => void;
  onResetCustomization: () => void;
}

export interface WorkspacePreviewQualityControlState {
  quality: WorkspacePreviewQuality;
  onSelectQuality: (quality: WorkspacePreviewQuality) => void;
}

export interface WorkspaceStatusBadge {
  text: ReactNode;
  showRetry?: boolean;
  onRetry?: () => void;
}

export interface WorkspaceAspectOption {
  aspect: WorkspaceAspect;
  status: "ready" | "busy" | "available";
  title: string;
}

export interface AnimationWorkspaceProps {
  /** Current viewed aspect ratio. */
  aspect: WorkspaceAspect;
  /** Aspect picker options and selection callback. */
  aspects: readonly WorkspaceAspectOption[];
  onSelectAspect: (aspect: WorkspaceAspect) => void;
  /** Top-level error alert banners, if any. */
  errors?: readonly string[];
  /** Which options the engine supports (omitted options are hidden, not disabled). */
  optionsConfig?: WorkspaceOptionsConfig;
  /** Audio track toggle state and handlers. */
  audioControls?: WorkspaceAudioControlState;
  /** Subtitle customization state and handlers. */
  subtitleControls?: WorkspaceSubtitleControlState;
  /** Preview quality control for plate films (Low 0.2 / Standard 0.4 / High 0.6). */
  previewQualityControls?: WorkspacePreviewQualityControlState;
  /** Optional status chip and retry button at the end of the options bar. */
  statusBadge?: WorkspaceStatusBadge | null;
  /** Renders the engine-specific stage surface inside `.aw-canvas`. */
  renderStage: () => ReactNode;
  /** Optional click handler on the stage canvas (e.g. toggle play/pause). */
  onStageClick?: () => void;
  /** Optional ref to the `.aw-canvas` element (used for pointer drag calculations). */
  canvasRef?: RefObject<HTMLDivElement | null>;
  /** Extra hidden media elements (e.g. `<audio>` tags) mounted inside `.aw-frame`. */
  frameExtras?: ReactNode;
  /** Playback controls state. */
  playing: boolean;
  playDisabled?: boolean;
  onTogglePlay: () => void;
  currentTime: number;
  totalDuration: number;
  currentSceneIndex: number;
  currentSceneLabel: string;
  volume: number;
  muted: boolean;
  onToggleMute: () => void;
  onChangeVolume: (volume: number) => void;
  /** Scene tabs & timeline scrubbing. */
  scenes: readonly WorkspaceSceneTab[];
  onSeek: (seconds: number) => void;
  /** Comments panel state and handlers. */
  comments: readonly WorkspaceComment[];
  commentDraft: string;
  onChangeCommentDraft: (draft: string) => void;
  onCommentFocus?: () => void;
  canAddComment: boolean;
  addingComment?: boolean;
  onAddComment: () => void;
  onRemoveComment: (id: string) => void;
  onApplyComments: () => void;
  applyingComments?: boolean;
  applyBusyLabel?: string;
  applyIdleEmptyLabel?: string;
  applyPrefix?: string;
  commentsNote?: string;
  /** Primary render action at the top of the right column. */
  onRender?: () => void;
  rendering?: boolean;
  cost?: number;
}

export type FinalViewRatioStatus = "ready" | "preparing" | "failed";

export interface FinalViewRatio {
  id: string;
  label: string;
  status: FinalViewRatioStatus;
  progress?: number;
  url: string | null;
  error?: string;
  downloadName: string;
}

export interface FinalViewProps {
  title: string;
  subtitle: string;
  ratios: readonly FinalViewRatio[];
  initialRatio: string;
  shape: (ratioId: string) => string;
  poster?: string;
  onBack: () => void;
  onApprove: () => void | Promise<void>;
  approved: boolean;
  backLabel?: string;
  renderPreparingText?: (ratio: FinalViewRatio) => string;
  renderFailedText?: (ratio: FinalViewRatio) => string;
}
