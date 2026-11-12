export type Provider = "anthropic" | "gemini" | "openai-compatible";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type StepId =
  | "script"
  | "scriptWrite"
  | "sceneInsert"
  | "director"
  | "frameSketch"
  | "motion"
  | "screenshot"
  | "voiceAlign"
  | "sceneWriter"
  | "sceneRepair"
  | "formatFill"
  | "proAssistant"
  | "skillRouting"
  | "rewriteBeat"
  | "elementEdits"
  | "planner"
  | "siteRead";

export type StepDef = {
  id: StepId;
  /** SCREAMING_SNAKE suffix used in MODEL_<ENV>, EFFORT_<ENV>, MAX_TOKENS_<ENV>, BASE_URL_<ENV>. */
  env: string;
  label: string;
  parent?: StepId;
  /** Reads today's env names lazily from process.env (or a supplied env), never at import time. */
  legacy: (env?: NodeJS.ProcessEnv) => { provider: Provider; model: string };
  /** Step-specific legacy env var names (checked before MODEL_DEFAULT). */
  legacyVars?: readonly string[];
  /** Whether the step falls back to ANTHROPIC_MODEL when no step-specific legacy var or MODEL_DEFAULT is set. */
  usesAnthropicModel?: boolean;
  effort?: Effort;
  maxTokens: number;
  modality: "text" | "audio";
  anyProvider: boolean;
  note?: string;
};

const anthropicModel = (env: NodeJS.ProcessEnv = process.env): string =>
  "claude-haiku-5-5";

export const STEPS: Record<StepId, StepDef> = {
  script: {
    id: "script",
    env: "SCRIPT",
    label: "JSON script draft",
    legacyVars: ["SCRIPT_PROVIDER", "SCRIPT_MODEL"],
    legacy: (env = process.env) => {
      const provider: Provider = env.SCRIPT_PROVIDER === "gemini" ? "gemini" : "anthropic";
      const model = env.SCRIPT_MODEL || (provider === "gemini" ? "gemini-3.1-pro-preview" : "claude-haiku-5-5");
      return { provider, model };
    },
    maxTokens: 16000,
    modality: "text",
    anyProvider: true
  },
  scriptWrite: {
    id: "scriptWrite",
    env: "SCRIPT_WRITE",
    label: "Canvas streaming script writer + revise",
    parent: "script",
    legacyVars: ["SCRIPT_MODEL"],
    usesAnthropicModel: true,
    legacy: (env = process.env) => ({
      provider: "anthropic",
      model: env.SCRIPT_MODEL || anthropicModel(env)
    }),
    effort: "low",
    maxTokens: 16000,
    modality: "text",
    anyProvider: true
  },
  sceneInsert: {
    id: "sceneInsert",
    env: "SCENE_INSERT",
    label: "Insert one scene into script",
    parent: "script",
    legacyVars: ["SCRIPT_MODEL"],
    usesAnthropicModel: true,
    legacy: (env = process.env) => ({
      provider: "anthropic",
      model: env.SCRIPT_MODEL || anthropicModel(env)
    }),
    effort: "low",
    maxTokens: 900,
    modality: "text",
    anyProvider: true
  },
  director: {
    id: "director",
    env: "DIRECTOR",
    label: "Storyboard beat plan director",
    legacyVars: ["DIRECTOR_PROVIDER", "DIRECTOR_MODEL"],
    legacy: (env = process.env) => {
      const provider: Provider = env.DIRECTOR_PROVIDER === "gemini" ? "gemini" : "anthropic";
      const model = env.DIRECTOR_MODEL || (provider === "gemini" ? "gemini-3.1-pro-preview" : "claude-opus-5-5");
      return { provider, model };
    },
    maxTokens: 16000,
    modality: "text",
    anyProvider: true
  },
  frameSketch: {
    id: "frameSketch",
    env: "FRAME_SKETCH",
    label: "SVG storyboard frame sketch",
    legacyVars: ["FRAME_MODEL", "SCRIPT_MODEL"],
    usesAnthropicModel: true,
    legacy: (env = process.env) => ({
      provider: "anthropic",
      model: env.FRAME_MODEL || env.SCRIPT_MODEL || anthropicModel(env)
    }),
    effort: "low",
    maxTokens: 6000,
    modality: "text",
    anyProvider: true
  },
  motion: {
    id: "motion",
    env: "MOTION",
    label: "Frame motion code",
    legacyVars: ["MOTION_MODEL", "FRAME_MODEL"],
    usesAnthropicModel: true,
    legacy: (env = process.env) => ({
      provider: "anthropic",
      model: env.MOTION_MODEL || env.FRAME_MODEL || anthropicModel(env)
    }),
    effort: "low",
    maxTokens: 3000,
    modality: "text",
    anyProvider: true
  },
  screenshot: {
    id: "screenshot",
    env: "SCREENSHOT",
    label: "Uploaded screenshot reader",
    legacyVars: ["SCREENSHOT_MODEL"],
    legacy: (env = process.env) => ({
      provider: "anthropic",
      model: env.SCREENSHOT_MODEL || "claude-haiku-5-5"
    }),
    maxTokens: 1200,
    modality: "text",
    anyProvider: true,
    note: "sends images"
  },
  voiceAlign: {
    id: "voiceAlign",
    env: "VOICE_ALIGN",
    label: "Voiceover word timestamp alignment",
    legacyVars: ["VOICE_ALIGN_MODEL"],
    legacy: (env = process.env) => ({
      provider: "gemini",
      model: env.VOICE_ALIGN_MODEL || "gemini-3.8-flash"
    }),
    maxTokens: 8192,
    modality: "audio",
    anyProvider: false,
    note: "gemini only"
  },
  sceneWriter: {
    id: "sceneWriter",
    env: "SCENE_WRITER",
    label: "Plate scene code author",
    legacyVars: ["PLATE_MODEL"],
    usesAnthropicModel: true,
    legacy: (env = process.env) => ({
      provider: "anthropic",
      model: env.PLATE_MODEL || anthropicModel(env)
    }),
    maxTokens: 24000,
    modality: "text",
    anyProvider: true
  },
  sceneRepair: {
    id: "sceneRepair",
    env: "SCENE_REPAIR",
    label: "Plate scene repair pass",
    parent: "sceneWriter",
    legacyVars: ["PLATE_MODEL"],
    usesAnthropicModel: true,
    legacy: (env = process.env) => ({
      provider: "anthropic",
      model: env.PLATE_MODEL || anthropicModel(env)
    }),
    maxTokens: 24000,
    modality: "text",
    anyProvider: true
  },
  formatFill: {
    id: "formatFill",
    env: "FORMAT_FILL",
    label: "Fixed-structure format slot fill",
    legacyVars: [],
    usesAnthropicModel: true,
    legacy: (env = process.env) => ({
      provider: "anthropic",
      model: anthropicModel(env)
    }),
    maxTokens: 2000,
    modality: "text",
    anyProvider: true,
    note: "JSON schema"
  },
  proAssistant: {
    id: "proAssistant",
    env: "PRO_ASSISTANT",
    label: "Pro composition source edit assistant",
    legacyVars: [],
    usesAnthropicModel: true,
    legacy: (env = process.env) => ({
      provider: "anthropic",
      model: anthropicModel(env)
    }),
    maxTokens: 6500,
    modality: "text",
    anyProvider: true,
    note: "JSON schema"
  },
  skillRouting: {
    id: "skillRouting",
    env: "SKILL_ROUTING",
    label: "Author skill bundle router",
    legacyVars: ["ANTHROPIC_ROUTING_MODEL"],
    legacy: (env = process.env) => ({
      provider: "anthropic",
      model: env.ANTHROPIC_ROUTING_MODEL || "claude-haiku-5-5"
    }),
    maxTokens: 128,
    modality: "text",
    anyProvider: true
  },
  rewriteBeat: {
    id: "rewriteBeat",
    env: "REWRITE_BEAT",
    label: "Single storyboard beat rewrite",
    legacyVars: [],
    usesAnthropicModel: true,
    legacy: (env = process.env) => ({
      provider: "anthropic",
      model: anthropicModel(env)
    }),
    maxTokens: 600,
    modality: "text",
    anyProvider: true
  },
  elementEdits: {
    id: "elementEdits",
    env: "ELEMENT_EDITS",
    label: "Canvas comment-to-patch translator",
    legacyVars: [],
    usesAnthropicModel: true,
    legacy: (env = process.env) => ({
      provider: "anthropic",
      model: anthropicModel(env)
    }),
    maxTokens: 450,
    modality: "text",
    anyProvider: true
  },
  planner: {
    id: "planner",
    env: "PLANNER_FILL",
    label: "Starter template slot planner",
    legacyVars: [],
    usesAnthropicModel: true,
    legacy: (env = process.env) => ({
      provider: "anthropic",
      model: anthropicModel(env)
    }),
    maxTokens: 1024,
    modality: "text",
    anyProvider: true,
    note: "render/anthropic-planner.ts, Anthropic tool use or Gemini/OpenAI structured JSON"
  },
  siteRead: {
    id: "siteRead",
    env: "SITE_READ",
    label: "Public URL fallback reader",
    legacyVars: ["SITE_READ_MODEL"],
    legacy: (env = process.env) => ({
      provider: "gemini",
      model: env.SITE_READ_MODEL || "gemini-3.8-flash"
    }),
    maxTokens: 8192,
    modality: "text",
    anyProvider: false,
    note: "gemini only (uses url_context tool)"
  }
};

/** Media generation steps that have their own modality-specific APIs and are not routed through callModel. */
export const NOT_ROUTED = [
  { id: "tts", env: null, defaultModel: "gemini-3.8-flash-tts", note: "audio/gemini-tts.ts" },
  { id: "music", env: null, defaultModel: "lyria-3-clip-preview / lyria-3-pro-preview", note: "plan/music.ts" },
  { id: "visualImage", env: "VISUAL_IMAGE_MODEL", defaultModel: "gemini-3.1-flash-image", note: "config.visualImageModel" },
  { id: "visualVideo", env: "VISUAL_VIDEO_MODEL", defaultModel: "veo-3.1-fast-generate-preview", note: "config.visualVideoModel" }
] as const;
