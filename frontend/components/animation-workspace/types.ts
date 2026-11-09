import type { ReactNode, RefObject } from "react";

export type WorkspaceAspect = "16:9" | "9:16" | "1:1";
export type WorkspaceSubtitleMode = "none" | "key-phrases" | "full";
export type WorkspaceSubtitleStyle = "pill" | "cinema" | "kinetic" | "paper" | "blueprint";
export type WorkspaceAudioTrackId = "voice" | "music" | "sfx" | "transitions";
export type WorkspacePreviewQuality = 0.2 | 0.4 | 0.6;
export type WorkspacePlaybackRenderMode = "draft" | "full";

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
  /** Optional live status text shown on the segment chip (e.g. "Waiting", "Writing 40%", "Drawing 42/120"). */
  progressLabel?: string;
  /** Optional 0..1 progress fraction for the per-segment mini bar. */
  progressFraction?: number | null;
  /** Optional sketch/reference frame URL shown as a faint background thumbnail until drawn. */
  thumbnail?: string | null;
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
  /** Whether the engine supports the final-render motion-blur toggle. */
  motionBlur?: boolean;
  /** Optional control state forwarded when rendered through AnimationWorkspace. */
  motionBlurControls?: WorkspaceMotionBlurControlState;
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
  motionBlur: boolean;
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
  renderMode?: WorkspacePlaybackRenderMode;
  onSelectRenderMode?: (mode: WorkspacePlaybackRenderMode) => void;
}

export interface WorkspaceMotionBlurControlState {
  enabled: boolean;
  disabled?: boolean;
  durationSeconds: number;
  onToggle: (enabled: boolean) => void;
}

export interface WorkspaceStatusBadge {
  text: ReactNode;
  showRetry?: boolean;
  retryLabel?: string;
  onRetry?: () => void;
}

export interface WorkspaceFilmToast {
  /** Whether any scene is currently being written, checked, or drawn. */
  active: boolean;
  /** First line: what is being built right now (e.g. "Scene 5 is being written · about 1 min" or "Retrying scene 3 (the drawing worker restarted)"). */
  firstLine: string;
  /** Second line: film summary (e.g. "6 of 7 written · 6 drawn · about 4 min left"). */
  secondLine: string;
  /** Compact summary for narrow viewports (e.g. "6/7 written · 6 drawn · ~4 min"). */
  compactLine: string;
  /** Determinate film progress percentage (0..100). */
  percent: number;
}

export interface WorkspaceSceneBanner {
  /** 0-based index of the unready scene explained by the banner. */
  sceneIndex: number;
  /** Visual state category matching the scene's timeline chip dot ("updating" | "needs-update" | "ready"). */
  visualState: WorkspaceSceneTabVisualState;
  /** Where to anchor the banner inside the stage frame ("top" for the selected scene, "timeline" when explaining a scene ahead). */
  placement: "top" | "timeline";
  /** Single-line status text (e.g. "Scene 7 is being written · about 2 min"). */
  text: string;
}

export interface WorkspaceAspectOption {
  aspect: WorkspaceAspect;
  status: "ready" | "busy" | "available";
  title: string;
}

export interface WorkspaceFpsMeterProps {
  /** Whether playback is currently active. */
  playing: boolean;
  /** Whether the active scene is currently buffering or preparing. */
  buffering?: boolean;
  /** Active scene source kind ("clip" for `<video>`, "live" for canvas live stage). */
  source: "clip" | "live";
  /** Active scene identifier so the meter re-attaches when the active scene changes. */
  sceneKey: string | number;
  /** Returns the active `<video>` element when `source === "clip"`. */
  getVideoElement?: () => HTMLVideoElement | null;
  /** Returns the live stage's cumulative presented frame count and media time when `source === "live"`. */
  getLiveMetrics?: () => { presentedFrames: number; mediaTimeSec: number; buffering?: boolean } | null;
  /** Optional direct snapshot override. */
  snapshot?: import("./fps").FpsMeterSnapshot | null;
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
  /** Final-render motion-blur control for engines that support it (HyperFrames). */
  motionBlurControls?: WorkspaceMotionBlurControlState;
  /** Optional status chip and retry button at the end of the options bar. */
  statusBadge?: WorkspaceStatusBadge | null;
  /** Optional floating film-progress toast overlay at the top-centre of the stage frame. */
  filmToast?: WorkspaceFilmToast | null;
  /** Optional single-line unready-scene banner inside the stage frame, linked to its timeline chip. */
  sceneBanner?: WorkspaceSceneBanner | null;
  /** Optional real-time playback FPS meter chip in the top-right corner of the canvas. */
  fpsMeter?: WorkspaceFpsMeterProps | null;
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
  onRetryScene?: (sceneIndex: number) => void;
  retryingSceneIndex?: number | null;
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
  renderDisabled?: boolean;
  renderTitle?: string;
  cost?: number;
  renderButtonRef?: RefObject<HTMLButtonElement | null>;
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
