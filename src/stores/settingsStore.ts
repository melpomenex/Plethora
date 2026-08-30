import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { migratedGetItem } from "../lib/brandMigration";
import {
  createDefaultTTSSettings,
  sanitizeTTSSettings,
  type TTSSettings,
} from "../utils/ttsSettings";
import { normalizeFsrsParameters } from "../utils/fsrsParameters";
import { isNativeMobile } from "../lib/tauri";
import type { SchedulerId } from "../lib/schedulerIdentity";
import { LEGACY_LEARNING_KEYS, normalizeSchedulerId } from "../lib/schedulerIdentity";
import type { ActiveRecallMode } from "../lib/ai/recall/interruptionPolicy";
import type { StudyAction } from "../types/audioEdition";

export type { ActiveRecallMode };

/** Valid `ai.activeRecallMode` values (unknown persisted values reset to off). */
const ACTIVE_RECALL_MODES: readonly ActiveRecallMode[] = ["off", "low", "adaptive", "intensive"];

/**
 * Sidebar (toolbar rail) expanded-width bounds, in px. Default 184 matches the
 * historical `--toolbar-expanded-w: 11.5rem`; the collapsed rail (3rem) is
 * never resized by this setting.
 */
export const SIDEBAR_WIDTH_MIN = 128; // 8rem — enough to fit labels/icons
export const SIDEBAR_WIDTH_MAX = 320; // 20rem — cap so content never overflows
export const SIDEBAR_WIDTH_DEFAULT = 184; // 11.5rem — current Plethora behavior

/** Clamp any persisted/typed value into the sidebar-width range. */
export function clampSidebarWidth(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return SIDEBAR_WIDTH_DEFAULT;
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(value)));
}

function normalizeActiveRecallMode(value: unknown): ActiveRecallMode {
  return typeof value === "string" && (ACTIVE_RECALL_MODES as readonly string[]).includes(value)
    ? (value as ActiveRecallMode)
    : "off";
}

/**
 * FSRS Algorithm Parameters
 */
export interface FSRSParams {
  desiredRetention: number;
  maximumInterval: number;
  personalizedWeights?: number[];
  lastOptimizationAt?: string;
  optimizedReviewCount?: number;
}

export interface FSRSScopeOverride {
  id: string;
  scopeType: "deck" | "tag";
  scopeId: string;
  desiredRetention?: number;
  maximumInterval?: number;
  personalizedWeights?: number[];
  enabled: boolean;
}

/**
 * Postpone Settings (Precision algorithm-aware postponement)
 */
export interface PostponeSettings {
  // Item parameters
  itemIncrease: number;
  itemMinIncrease: number;
  itemMaxIncrease: number;
  itemCap: number;
  itemFloor: number;

  // Topic (document) parameters
  topicIncrease: number;
  topicMinIncrease: number;
  topicMaxIncrease: number;
  topicCap: number;
  topicFloor: number;

  // Eligibility thresholds
  minElapsed: number;
  minPriority: number;
  minPriority2: number;
  minStability: number;
  topicPriorityMin: number;
  topicRepMin: number;
  topicElapsedMin: number;

  // Behavior
  randomize: boolean;
  simpleMode: boolean;
  autoPostponeEnabled: boolean;
}

/**
 * Learning Settings
 */
export interface LearningSettings {
  algorithm: SchedulerId;
  newCardsPerDay: number;
  reviewsPerDay: number;
  initialInterval: number;
  graduatingInterval: number;
  easyInterval: number;
  lapseSteps: number[];
  lapseInterval: number;
  leechThreshold: number;
  maxReviewTime: number;
  fsrsParams: FSRSParams;
  scopedFsrsOverrides: FSRSScopeOverride[];
  timezone: string;
  postpone: PostponeSettings;
  precisionPureKernel: boolean;
  /** Whether Precision commits Arena Pick immediately or opens the post-grade chooser. */
  arenaReviewMode: "automatic" | "choose";
}

/**
 * Hands-free audio read-aloud review mode settings.
 */
export interface AudioReviewModeSettings {
  enabled: boolean;
  autoFlip: boolean;
  autoFlipDelayMs: number;
  defaultRating: 1 | 2 | 3 | 4;
  algorithmArenaCoachCompleted?: boolean;
}

/**
 * Embedding provider/model for whole-library RAG chat.
 */
export interface EmbeddingSettings {
  provider: "openai" | "cohere" | "openrouter" | "ollama";
  openaiModel?: string;
  cohereModel?: string;
  openrouterModel?: string;
  ollamaBaseUrl: string;
  ollamaModel?: string;
  chunkSize: number;
  chunkOverlap: number;
  topK: number;
  minSimilarity: number;
  /**
   * Explicit consent to billable (cloud) embeddings (ai-billing-safety).
   * Off by default; gates every billable embedding call path.
   */
  paidEmbeddingsEnabled: boolean;
}

/**
 * PDF Settings
 */
export interface PDFSettings {
  defaultZoom: number;
  twoPageSpread: boolean;
  showOcrPageBreaks: boolean;
  preferredMobileMode: "auto" | "reflow" | "fixed";
  reflowFontFamily: "serif" | "sans-serif" | "monospace";
  reflowFontSize: number;
  reflowLineHeight: number;
  reflowMargin: number;
  reflowDirection: "auto" | "ltr" | "rtl";
  reflowImageScaling: "fit" | "original" | "hide";
  reflowTheme: "system" | "light" | "dark";
  fixedMobileMode: "fit-width" | "fit-page" | "crop" | "columns";
  fixedColumns: number;
  fixedColumnDirection: "ltr" | "rtl";
  fixedColumnOverlap: number;
}

/**
 * EPUB Settings
 */
interface EPUBSettings {
  fontSize: number;
  fontFamily: "serif" | "sans-serif" | "monospace";
  lineHeight: number;
  autoScroll: boolean;
}

/**
 * HTML Viewer Settings
 */
interface HTMLSettings {
  fontSize: number;
  fontFamily: "serif" | "sans-serif" | "monospace";
  lineHeight: number;
}

/**
 * Segmentation Settings
 */
interface SegmentationSettings {
  method: "semantic" | "paragraph" | "fixed" | "smart";
  targetLength: number;
  overlap: number;
}

/**
 * OCR Settings
 */
interface OCRSettings {
  provider: "tesseract" | "google" | "aws" | "azure" | "marker" | "nougat" | "glm" | "mistral" | "windows-system";
  language: string;
  autoOCR: boolean;
  tesseract_path?: string;
  googleProjectId?: string;
  googleLocation?: string;
  googleProcessorId?: string;
  googleCredentialsPath?: string;
  awsRegion?: string;
  awsAccessKey?: string;
  awsSecretKey?: string;
  azureEndpoint?: string;
  azureApiKey?: string;
  marker_path?: string;
  nougat_path?: string;
  glmEndpoint?: string;
  glmModel?: string;
  glmApiKey?: string;
  glmBackend?: "ollama" | "vllm";
  glmOllamaPath?: string;
  mistralApiKey?: string;
  preferLocal: boolean;
  preferWindowsSystemOcr?: boolean;
  mathOcrEnabled: boolean;
  mathOcrCommand?: string;
  mathOcrModelDir?: string;
  keyPhraseExtraction: boolean;
  autoExtractOnLoad: boolean;
}

/**
 * Document Settings
 */
interface DocumentSettings {
  defaultCategory: string;
  autoProcessOnImport: boolean;
  detectDuplicates: boolean;
  webImportPreserveImages: boolean;
  /**
   * Keep gzip snapshots of fetched article HTML (source-snapshots/*.html.gz)
   * for future re-extraction. Default ON. Turning it OFF deletes every
   * existing snapshot and skips storing new ones; articles themselves are
   * unaffected. Snapshots live outside the cloud-backup documents folder:
   * re-extraction works on-device, but restores lose snapshots.
   */
  webImportKeepRawSource: boolean;
  pdfSettings: PDFSettings;
  epubSettings: EPUBSettings;
  htmlSettings: HTMLSettings;
  segmentation: SegmentationSettings;
  ocr: OCRSettings;
  smartTagging: SmartTaggingSettings;
  cacheContent: boolean;
  autoCleanupCache: boolean;
}

export interface SmartTaggingSettings {
  enabled: boolean;
  mode: "automatic" | "suggestions-only";
  maxTagsPerDocument: number;
  preferExistingTags: boolean;
}

/**
 * Appearance Settings
 */
interface AppearanceSettings {
  theme: "light" | "dark" | "system";
  fontSize: number;
  fontFamily: string;
  visualFeedbackEnabled?: boolean;
  themeCustomizations?: {
    primaryColor?: string;
    fontFamily?: string;
  };
}

/**
 * General Settings
 */
/** Views the app can open on at startup. */
export type DefaultStartupView = "queue" | "review" | "documents" | "analytics";

interface GeneralSettings {
  language: string;
  startOfWeek: "sunday" | "monday";
  dateFormat: "us" | "iso" | "european";
  restoreSession: boolean;
  /** Which view the app opens on when a session is not being restored. */
  defaultView: DefaultStartupView;
  showFeaturePopups: boolean;
  /**
   * How many tabs may stay mounted at once. Beyond this, the least recently
   * active tab is unmounted and re-mounts when next opened — only for tab types
   * that restore cleanly (see `EVICTABLE_TAB_TYPES` in `tabsStore`). `0` keeps
   * every tab mounted forever, which is the pre-cap behavior.
   */
  residentTabCap: number;
  /**
   * How many expensive document readers (PDF/EPUB `document-viewer` tabs) may
   * stay mounted at once: the active reader plus a small number of warm ones.
   * Beyond this, the least recently used reader is unmounted (its reading
   * position is flushed first) and restored on reactivation. `0` keeps every
   * reader mounted; non-reader tabs are never evicted on account of this cap.
   */
  readerTabCap: number;
}

/**
 * Interface Settings
 */
export type VolumeRockerMode = "none" | "page" | "scroll";

import { DEFAULT_COMPANION_SETTINGS, type CompanionSettings } from "../lib/companion/types";

interface InterfaceSettings {
  showSidebar: boolean;
  showStats: boolean;
  compactMode: boolean;
  /** Use the dense library cockpit layout in Documents. */
  compactDocumentsView: boolean;
  animationsEnabled: boolean;
  /**
   * Knowledge Peck branded startup animation (default on, all platforms).
   * Deliberately NOT gated by `animationsEnabled`: that flag is forced off
   * on fresh native-mobile installs for ambient decoration, while the launch
   * moment is a one-shot ~1.5 s experience (design D8 of the
   * knowledge-peck-startup-animation change).
   */
  startupAnimationEnabled: boolean;
  /** Particle density / count multiplier for animated theme backdrops (0.25–8). */
  animationFrequency: number;
  /** Brightness gain stored in tenths, where 10 = 1.0x and 100 = 10.0x. */
  animationBrightness: number;
  reviewZenMode: boolean;
  conversationalReviewEnabled: boolean;
  toolbarPosition: "top" | "left" | "right";
  /**
   * Mouse gesture to duplicate the active tab into a new vertical split.
   * button: 0=left, 1=middle (wheel), 2=right
   */
  splitViewSpawn: {
    button: 0 | 1 | 2;
    modifier: "none" | "ctrl" | "alt" | "shift" | "meta";
  };
  volumeRockerScroll?: VolumeRockerMode;
  /**
   * User-configurable expanded sidebar (toolbar rail) width in px. The
   * collapsed rail stays fixed at `--toolbar-rail-w` (3rem) so icons always
   * fit; this value feeds `--toolbar-expanded-w`. Mobile shells render no
   * desktop toolbar rail, so the value is ignored there. Bounds are enforced
   * by `SIDEBAR_WIDTH_MIN`/`SIDEBAR_WIDTH_MAX` on merge and in the Settings UI.
   */
  sidebarWidth: number;
  /** Optional ambient mascot companion (see src/lib/companion). */
  companion?: CompanionSettings;
}

/**
 * AI Controls Settings (auto-generation, summarization, context window)
 */
export interface AIControlsSettings {
  autoGenerate: boolean;
  /** @deprecated Use flashcardFixedCount instead. Retained for migration only. */
  cardsPerExtract: number;
  qualityThreshold: number;
  requireApproval: boolean;
  autoSummarize: boolean;
  summaryLength: "short" | "medium" | "long";
  includeSummaryInCards: boolean;
  maxTokensPerRequest: number;
  contextFromRelatedCards: boolean;
  documentSnippetLength: number;
  /** How the flashcard generation target card count is determined. */
  flashcardCountMode: "fixed" | "auto";
  /** Exact card count requested when flashcardCountMode is "fixed". */
  flashcardFixedCount: number;
  /** Lower bound on the computed target when flashcardCountMode is "auto". */
  flashcardAutoMin: number;
  /** Upper bound on the computed target when flashcardCountMode is "auto". */
  flashcardAutoMax: number;
}

/**
 * AI Settings
 */
interface AISettings {
  enabled: boolean;
  provider: "openai" | "anthropic" | "openrouter" | "ollama";
  model: string;
  apiKey?: string;
  temperature: number;
  maxTokens: number;
  ollamaBaseUrl?: string;
  // PWA-only: floating voice assistant button while reading documents.
  pwaAssistantButtonEnabled: boolean;
  pwaAssistantButtonSide: "left" | "right";
  aiControls: AIControlsSettings;
  memoryEnabled: boolean;
  /**
   * Prefer on-device inference (Gemini Nano / Apple Foundation Models / Core AI)
   * over a cloud provider when a live on-device provider can serve the task.
   */
  preferOnDevice: boolean;
  /**
   * Optional pin among on-device backends. Unset keeps natural order
   * (Nano, then Apple FM, then Core AI).
   */
  preferredOnDeviceProviderId?:
    | "ondevice-gemini-nano"
    | "ondevice-apple-foundation"
    | "ondevice-apple-coreai"
    | "ondevice-windows-system"
    | "ondevice-foundry-local";
  /**
   * Whether an on-device failure may automatically retry on a configured
   * cloud provider (design D27). Default **false** since ai-billing-safety
   * (#14): an on-device failure must not silently route content to a paid
   * cloud provider. Enabling it is the explicit "on-device only is not
   * required" opt-in; the retry keeps the informational toast.
   */
  allowCloudFallback: boolean;
  /** When true, Apple Foundation Models appear as an Assistant provider on Apple platforms. */
  assistantUseAppleFoundation: boolean;
  /**
   * Active-recall reading mode (design D19 / ai-active-recall): `off` (the
   * default and the kill switch), or the interruption budget `low` /
   * `adaptive` / `intensive`. Only takes effect together with the
   * `features.aiActiveRecall` flag.
   */
  activeRecallMode: ActiveRecallMode;
}


/**
 * Import/Export Settings
 */
interface ImportExportSettings {
  autoBackup: boolean;
  backupInterval: number;
  includeMedia: boolean;
}

/**
 * Notification Settings
 */
interface NotificationSettings {
  enabled: boolean;
  studyReminders: boolean;
  reminderTime: string;
  dueDateReminders: boolean;
  soundEnabled: boolean;
  notificationSound: string;
  soundVolume: number;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  showBadge: boolean;
  feedbackSoundsEnabled: boolean;
  feedbackVolume: number;
}

/**
 * Privacy Settings
 */
interface PrivacySettings {
  telemetryEnabled: boolean;
  crashReportsEnabled: boolean;
  analyticsEnabled: boolean;
}

interface SearchSettings {
  /** Donate display-eligible Core Spotlight items. Default off. */
  systemSpotlightEnabled: boolean;
}

/**
 * Groq Transcription Settings
 */
interface GroqTranscriptionSettings {
  apiKey: string;
  model: "whisper-large-v3" | "whisper-large-v3-turbo";
  useFreeTier: boolean;
  usage: {
    lastResetDate: string;
    audioSecondsProcessed: number;
    requestsMade: number;
  };
}

/**
 * Audio Transcription Settings
 */
interface AudioTranscriptionSettings {
  provider: "local" | "groq" | "apple" | "android-ondevice" | "openrouter";
  /** User-facing transcription routing mode (preferred over legacy `provider`). */
  mode?: "auto" | "fast" | "enhanced" | "realtime" | "offline";
  /** Provider category: Automatic, Local, OpenRouter, Premium. */
  sttProvider?: "automatic" | "local" | "openrouter" | "premium";
  /** Model selection: automatic or logical model key. */
  sttModel?: "automatic" | string;
  /** Prefer installed local Nemotron in Automatic mode when performant. */
  preferLocal?: boolean;
  /** Allow fallback to alternate providers/models on failure. */
  automaticFallback?: boolean;
  /** OpenRouter STT configuration (default model, etc.). */
  openrouter?: {
    defaultModel?: string;
  };
  /** When true, ML Kit Speech may run; existing whisper/sherpa/Groq stay default. */
  preferAndroidSpeech: boolean;
  autoTranscription: boolean;
  autoTranscribeLocalVideos: boolean;
  preferredModelId?: string;
  language: string;
  timestampGeneration: boolean;
  speakerDiarization: boolean;
  confidenceScores: boolean;
  confidenceThreshold: number;
  groq: GroqTranscriptionSettings;
  /** Premium transcription quota tracking (minutes). */
  premiumMinutesUsed?: number;
  premiumMonthlyAllowance?: number;
  /** BYOK Deepgram credentials for realtime/file transcription. */
  deepgram?: {
    apiKey?: string;
  };
  /** Android on-device engine preferences (sherpa-onnx STT plugin). */
  androidOnDevice?: {
    /** Explicit model choice; empty/undefined = auto per language. */
    modelId?: string;
    /** Thermal pacing: capped (2 threads, default) or full (4 threads). */
    pacing: "capped" | "full";
  };
}

/**
 * Smart Queue Settings
 */
interface SmartQueueSettings {
  autoRefresh: boolean;
  refreshInterval: number;
  queueStrategyPreset: string;
  sessionItemTypes?: {
    documents?: boolean;
    extracts?: boolean;
    learningItems?: boolean;
  };
  /** See the same field in types/settings.ts SmartQueueSettings. */
  sessionItemTypesCustomized?: boolean;
}

/**
 * Scroll Queue Settings
 */
interface ScrollQueueSettings {
  /** Target share of each item type in a composed scroll session (0-100 each; need not sum to 100). */
  composition: { documents: number; extracts: number; flashcards: number };
  autoProceed: boolean; // Auto-proceed to next item in the queue when a video/audio ends
  ratingOrbsPosition?: "left" | "right" | "top" | "bottom"; // Snapped position of rating orbs
}

/**
 * Shape persisted before the composition sliders existed. The old model was a
 * single `flashcardPercentage` plus an `extractsCountAsFlashcards` boolean.
 */
type LegacyScrollQueueSettings = Partial<ScrollQueueSettings> & {
  flashcardPercentage?: number;
  extractsCountAsFlashcards?: boolean;
};

/**
 * Merge persisted scroll-queue settings over the defaults, migrating the old
 * `flashcardPercentage` / `extractsCountAsFlashcards` shape into a
 * `composition` when needed.
 *
 * `flashcards` keeps the old percentage; the remainder is split between
 * documents and extracts using the old boolean as the hint (true — extracts
 * took a slice of the flashcard budget, so they get half of it; false —
 * extracts were independent, so they get a small fixed share). A saved 0%
 * must NOT become an all-zero composition: documents keep the full remainder.
 */
function mergeScrollQueueSettings(persisted?: Partial<ScrollQueueSettings>): ScrollQueueSettings {
  const legacy = (persisted ?? {}) as LegacyScrollQueueSettings;
  const merged: ScrollQueueSettings = {
    composition: legacy.composition ?? defaultSettings.scrollQueue.composition,
    autoProceed: legacy.autoProceed ?? defaultSettings.scrollQueue.autoProceed,
    ratingOrbsPosition: legacy.ratingOrbsPosition ?? defaultSettings.scrollQueue.ratingOrbsPosition,
  };
  if (legacy.composition === undefined && typeof legacy.flashcardPercentage === "number") {
    const pct = Math.min(100, Math.max(0, legacy.flashcardPercentage));
    const extracts =
      pct === 0
        ? 0
        : legacy.extractsCountAsFlashcards !== false
          ? Math.round(pct / 2)
          : 5;
    merged.composition = {
      documents: Math.max(0, 100 - pct - extracts),
      extracts,
      flashcards: pct,
    };
  }
  return merged;
}

/**
 * RSS Queue Settings
 */
export interface RSSQueueSettings {
  /** Whether to include RSS items in the main queue at all */
  includeInQueue: boolean;
  /** Percentage of queue items that should be RSS (0-100) */
  percentage: number;
  /** Maximum number of RSS items to include per session (0 = unlimited) */
  maxItemsPerSession: number;
  /** Hide RSS items older than this many days (0 = no limit) */
  maxItemAgeDays: number;
  /** Specific feed IDs to include in the queue (empty = all feeds) */
  includedFeedIds: string[];
  /** Feed IDs explicitly excluded from the queue */
  excludedFeedIds: string[];
  /** Whether to only include unread items */
  unreadOnly: boolean;
  /** Whether to prefer newer items */
  preferRecent: boolean;
  /** Show cover images in the article reader by default */
  showCoverImage?: boolean;
}

export interface PodcastQueueSettings {
  /** Whether to include podcast episodes in the scroll queue */
  includeInQueue: boolean;
  /** Maximum number of podcast episodes to include per session (0 = unlimited) */
  maxItemsPerSession: number;
  /** Whether to only include unplayed episodes */
  unreadOnly: boolean;
}

/**
 * RSS Summary Settings
 */
export interface RSSSummarySettings {
  /** Display mode: modern or terminal */
  mode: "modern" | "terminal";
  /** Default summary length */
  defaultLength: "brief" | "medium" | "detailed";
  /** Default focus area */
  defaultFocus: "key-points" | "actionable" | "background";
  /** Panel width in pixels */
  panelWidth: number;
  /** Panel position: left or right */
  panelPosition: "left" | "right";
  /** Whether panel is visible by default */
  autoOpen: boolean;
}

/**
 * YouTube API Settings
 */
interface YouTubeSettings {
  apiKey?: string;
  enabled: boolean;
  /** Custom YouTube transcript API server base URL */
  transcriptServerUrl?: string;
  /** API Key to authenticate with the custom transcript server */
  transcriptServerApiKey?: string;
  /** Whether on-device transcript fetching is enabled */
  transcriptOnDeviceEnabled: boolean;
}

/**
 * Feature Flags
 */
interface FeatureFlags {
  notebooklmEnabled: boolean;
  fsrsScopedParametersEnabled: boolean;
  reviewUndoEnabled: boolean;
  cramModeEnabled: boolean;
  // AI Learning System (OpenSpec `add-ondevice-ai-learning-system`) — one
  // flag per phase, ALL default false so every phase ships dark and can be
  // enabled per device for dogfooding (design D30 rollback guarantee).
  /** Phase 1: "Learn this" structured learning material proposals */
  aiLearnThis: boolean;
  /** Phase 2: OCR-backed occlusion selection on images */
  aiOcclusionAssist: boolean;
  /** Phase 2: experimental free-form (non-OCR) vision-proposed occlusion regions */
  aiOcclusionFreeform: boolean;
  /** Phase 3: on-device semantic indexing of the library */
  aiSemanticIndex: boolean;
  /** Phase 3: grounded Ask-Library RAG answers with citations */
  aiLibraryRag: boolean;
  /** Phase 4: active-recall prompts while reading */
  aiActiveRecall: boolean;
  /** Phase 4: free-response answer assessment feedback */
  aiAnswerAssessment: boolean;
  /** Phase 4: experimental highlighted grade suggestion (never auto-submits) */
  aiAutoGradeSuggest: boolean;
  /** Phase 5: prerequisite analysis and coverage estimation */
  aiPrerequisites: boolean;
  /** Phase 5: AI-proposed concept links and backlinks */
  aiConceptLinks: boolean;
  /** Phase 5: background extract-worthiness passage scoring */
  aiExtractWorthiness: boolean;
  /** Phase 6: Socratic tutoring sessions */
  aiSocraticTutor: boolean;
  /** Phase 7: constrained library agent (read-only + proposals) */
  aiAgent: boolean;
  /**
   * Optional Android AppSearch derived index (OpenSpec C). Default off —
   * SQLite / ai_learning remains the source of truth.
   */
  androidAppSearchIndex: boolean;
  /**
   * Selection-interaction controller v2 (OpenSpec
   * `overhaul-reader-selection-ux`): stability-gated selection UI, anchored
   * action bar, snapshot-owned action lifecycle. Ships dark; rollback =
   * disable the flag (old paths remain until the flag is removed).
   */
  selectionInteractionV2: boolean;
  /**
   * Dictionary Peek (OpenSpec `unify-selection-dictionary-lookup`): auto-open
   * the shared dictionary card when a settled selection resolves to a single
   * lexical word. Gates AUTO-OPEN only — the explicit dictionary rows
   * (context menu, selection action sheet) stay available when disabled.
   */
  dictionaryPeek: boolean;
  appleFoundationModels: boolean;
  appleSpotlightIndex: boolean;
  appleSpeechTranscription: boolean;
  appleVisionScan: boolean;
  appleNaturalLanguageEmbeddings: boolean;
  /** Phase 4; default off until iOS 27 catalog work is ready. */
  appleCoreAI: boolean;
  /** Windows System AI (Phi Silica) via plethora-windows-intelligence. */
  windowsSystemAi: boolean;
  /** Experimental WinRT structured-output paths on Windows desktop. */
  windowsAiExperimental: boolean;
}

/**
 * Hands-Free Study Mode settings v2 (design Decision 7). Replaces the v1
 * single/double/triple-press gesture model with per-command OS mappings.
 */
export interface HandsFreeStudySettings {
  /** Master toggle. Normal Mode (transport controls) is the default. */
  enabled: boolean;
  /** How much recent audio a capture tries to cover; "smart" snaps to semantic units (≤ 90 s). */
  captureWindow: 15 | 30 | 60 | "smart";
  /** Repeat-extension window in ms: a second Save Recent Extract within it extends the same capture. */
  extensionWindowMs: number;
  /** Study Mode action for each remappable OS command. Play/Pause are never remapped. */
  mappings: {
    next: StudyAction;
    previous: StudyAction;
    seekForward: StudyAction;
    seekBackward: StudyAction;
  };
  /** Audible confirmation earcons on/off. */
  chimeEnabled: boolean;
  /** Earcon volume 0..1 — actually consumed by `playChime`. */
  chimeVolume: number;
  /** Volume floor (0..1 of current volume) while ducked for a chime. */
  duckingRatio: number;
}

/** v1 shape persisted before the per-command mapping model existed. */
type LegacyHandsFreeStudySettings = Partial<HandsFreeStudySettings> & {
  captureLookbackSec?: number;
  singlePressAction?: string;
  doublePressAction?: string;
  triplePressAction?: string;
  audioChimeEnabled?: boolean;
};

const DEFAULT_HANDS_FREE_MAPPINGS: HandsFreeStudySettings["mappings"] = {
  next: "save_recent_extract",
  previous: "replay_recent_passage",
  seekForward: "skip_forward",
  seekBackward: "skip_backward",
};

export const DEFAULT_HANDS_FREE_STUDY_SETTINGS: HandsFreeStudySettings = {
  enabled: false,
  captureWindow: 30,
  extensionWindowMs: 2500,
  mappings: { ...DEFAULT_HANDS_FREE_MAPPINGS },
  chimeEnabled: true,
  chimeVolume: 0.8,
  duckingRatio: 0.25,
};

/** Every StudyAction the dispatcher implements; also drives the Settings UI pickers. */
export const VALID_STUDY_ACTIONS: readonly StudyAction[] = [
  "save_recent_extract",
  "bookmark",
  "replay_recent_passage",
  "mark_interesting",
  "mark_confusing",
  "ask_plethora",
  "skip_forward",
  "skip_backward",
  "next_chapter",
  "previous_chapter",
  "none",
];

/** Legacy v1 / camelCase action aliases → canonical StudyAction values. */
const LEGACY_ACTION_ALIASES: Record<string, StudyAction> = {
  // v1 dispatcher vocabulary
  smart_extract: "save_recent_extract",
  // camelCase variant of the canonical union
  saveRecentExtract: "save_recent_extract",
  replayRecentPassage: "replay_recent_passage",
  markInteresting: "mark_interesting",
  markConfusing: "mark_confusing",
  askPlethora: "ask_plethora",
  skipForward: "skip_forward",
  skipBackward: "skip_backward",
  nextChapter: "next_chapter",
  previousChapter: "previous_chapter",
};

/**
 * Coerce any persisted value into a valid StudyAction, falling back to the
 * mapping slot's default when unknown (design Decision 7: invalid values →
 * defaults, never an error).
 */
export function coerceStudyAction(value: unknown, fallback: StudyAction): StudyAction {
  if (typeof value === "string") {
    if ((VALID_STUDY_ACTIONS as readonly string[]).includes(value)) {
      return value as StudyAction;
    }
    const alias = LEGACY_ACTION_ALIASES[value];
    if (alias) return alias;
  }
  return fallback;
}

/**
 * Merge persisted hands-free settings over the defaults, migrating the v1
 * gesture shape (singlePressAction/doublePressAction/triplePressAction,
 * captureLookbackSec) defensively into v2 per-command mappings. Unknown
 * values at any layer fall back to that slot's default.
 */
export function mergeHandsFreeStudySettings(
  persisted?: Partial<HandsFreeStudySettings>
): HandsFreeStudySettings {
  const legacy = (persisted ?? {}) as LegacyHandsFreeStudySettings;

  // v1 stored the window as `captureLookbackSec`; v2 uses `captureWindow`.
  // A valid v2 value wins; otherwise a valid legacy value migrates; anything
  // else (missing/invalid) falls back to the default.
  let captureWindow: HandsFreeStudySettings["captureWindow"];
  const legacyLookback = [15, 30, 60].includes(legacy.captureLookbackSec as number)
    ? (legacy.captureLookbackSec as 15 | 30 | 60)
    : undefined;
  if (legacy.captureWindow === "smart" || [15, 30, 60].includes(legacy.captureWindow as number)) {
    captureWindow = legacy.captureWindow as HandsFreeStudySettings["captureWindow"];
  } else {
    captureWindow = legacyLookback ?? DEFAULT_HANDS_FREE_STUDY_SETTINGS.captureWindow;
  }

  // v1 → v2: the single-press action becomes the `next` mapping; double and
  // triple press actions are dropped (repeat-extension replaces them).
  const nextFromLegacy =
    legacy.mappings?.next ?? legacy.singlePressAction ?? DEFAULT_HANDS_FREE_MAPPINGS.next;

  const clampUnit = (value: unknown, min: number, max: number, fallback: number) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(max, Math.max(min, value))
      : fallback;

  return {
    enabled: legacy.enabled === true,
    captureWindow,
    extensionWindowMs: clampUnit(
      legacy.extensionWindowMs,
      500,
      10000,
      DEFAULT_HANDS_FREE_STUDY_SETTINGS.extensionWindowMs
    ),
    mappings: {
      next: coerceStudyAction(nextFromLegacy, DEFAULT_HANDS_FREE_MAPPINGS.next),
      previous: coerceStudyAction(
        legacy.mappings?.previous ?? DEFAULT_HANDS_FREE_MAPPINGS.previous,
        DEFAULT_HANDS_FREE_MAPPINGS.previous
      ),
      seekForward: coerceStudyAction(
        legacy.mappings?.seekForward ??
          (legacy.singlePressAction === "skip_forward" ? "skip_forward" : undefined),
        DEFAULT_HANDS_FREE_MAPPINGS.seekForward
      ),
      seekBackward: coerceStudyAction(
        legacy.mappings?.seekBackward,
        DEFAULT_HANDS_FREE_MAPPINGS.seekBackward
      ),
    },
    chimeEnabled:
      typeof legacy.chimeEnabled === "boolean"
        ? legacy.chimeEnabled
        : typeof legacy.audioChimeEnabled === "boolean"
          ? legacy.audioChimeEnabled
          : DEFAULT_HANDS_FREE_STUDY_SETTINGS.chimeEnabled,
    chimeVolume: clampUnit(
      legacy.chimeVolume,
      0,
      1,
      DEFAULT_HANDS_FREE_STUDY_SETTINGS.chimeVolume
    ),
    duckingRatio: clampUnit(
      legacy.duckingRatio,
      0,
      1,
      DEFAULT_HANDS_FREE_STUDY_SETTINGS.duckingRatio
    ),
  };
}

export interface PlethoraSettings {
  overrides: Record<string, boolean>;
}

/** Device/UI preferences for the language-learning surface.
 *
 * The active profile itself is durable native data scoped by account/workspace;
 * it intentionally does not live beside `general.language`, which is the app
 * UI locale. These flags only control presentation and suggestion behavior.
 */
/** `enabled` is the explicit global master opt-in for every Language Learning
 * surface (readers, selection flow, suggestions). It defaults to OFF and was
 * introduced at settings v11 with a forced-OFF migration, because the
 * pre-v11 persisted shape only carried presentation defaults
 * (`suggestionsEnabled`) that never constituted user opt-in. The per-device
 * choice is denylisted from the settings sync so an older install cannot
 * unset it. */
export interface LanguageLearningSettings {
  enabled: boolean;
  suggestionsEnabled: boolean;
  showUnavailableProviders: boolean;
}

/** Foundry Local (Windows Tier-2 on-device LLM runtime). */
export interface FoundryLocalSettings {
  enabled: boolean;
  baseUrl: string;
  model: string;
}

/**
 * Main Settings Interface
 */
export interface Settings {
  general: GeneralSettings;
  appearance: AppearanceSettings;
  interface: InterfaceSettings;
  learning: LearningSettings;
  documents: DocumentSettings;
  ai: AISettings;
  importExport: ImportExportSettings;
  notifications: NotificationSettings;
  privacy: PrivacySettings;
  search: SearchSettings;
  audioTranscription: AudioTranscriptionSettings;
  smartQueue: SmartQueueSettings;
  tts: TTSSettings;
  scrollQueue: ScrollQueueSettings;
  rssQueue: RSSQueueSettings;
  podcastQueue: PodcastQueueSettings;
  rssSummary: RSSSummarySettings;
  youtube: YouTubeSettings;
  features: FeatureFlags;
  foundryLocal: FoundryLocalSettings;
  audioReviewMode: AudioReviewModeSettings;
  embedding: EmbeddingSettings;
  handsFreeStudy: HandsFreeStudySettings;
  languageLearning: LanguageLearningSettings;
  plethora?: PlethoraSettings;
}

/**
 * Default Settings
 */
export const defaultSettings: Settings = {
  general: {
    language: "en",
    startOfWeek: "monday",
    dateFormat: "iso",
    restoreSession: true,
    defaultView: "queue",
    showFeaturePopups: true,
    // Deliberately above typical usage, so most sessions never evict anything;
    // it exists to bound a workspace that has grown all day.
    residentTabCap: 8,
    // Active reader plus one warm reader (design D11): keeps the common
    // alt-tab-between-two-documents flow reload-free while bounding how many
    // full document instances are resident at once.
    readerTabCap: 2,
  },
  appearance: {
    theme: "system",
    fontSize: 14,
    fontFamily: "system-ui",
  },
  interface: {
    showSidebar: true,
    showStats: true,
    compactMode: false,
    compactDocumentsView: false,
    animationsEnabled: true,
    startupAnimationEnabled: true,
    animationFrequency: 1,
    animationBrightness: 12,
    reviewZenMode: false,
    conversationalReviewEnabled: true,
    toolbarPosition: "left",
    sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
    splitViewSpawn: { button: 1, modifier: "none" },
    volumeRockerScroll: "none",
    companion: DEFAULT_COMPANION_SETTINGS,
  },
  learning: {
    algorithm: "fsrs",
    newCardsPerDay: 20,
    reviewsPerDay: 100,
    initialInterval: 0,
    graduatingInterval: 1,
    easyInterval: 4,
    lapseSteps: [10, 20, 30],
    lapseInterval: 1,
    leechThreshold: 8,
    maxReviewTime: 60,
    fsrsParams: {
      desiredRetention: 0.9,
      maximumInterval: 36500,
    },
    scopedFsrsOverrides: [],
    timezone: "auto",
    postpone: {
      itemIncrease: 50,
      itemMinIncrease: 1,
      itemMaxIncrease: 365,
      itemCap: 365,
      itemFloor: 1,
      topicIncrease: 40,
      topicMinIncrease: 1,
      topicMaxIncrease: 200,
      topicCap: 180,
      topicFloor: 1,
      minElapsed: 30,
      minPriority: 50,
      minPriority2: 60,
      minStability: 30,
      topicPriorityMin: 60,
      topicRepMin: 10,
      topicElapsedMin: 14,
      randomize: true,
      simpleMode: false,
      autoPostponeEnabled: false,
    },
    precisionPureKernel: false,
    arenaReviewMode: "automatic",
  },
  documents: {
    defaultCategory: "Uncategorized",
    autoProcessOnImport: false,
    detectDuplicates: true,
    smartTagging: {
      enabled: true,
      mode: "automatic",
      maxTagsPerDocument: 6,
      preferExistingTags: true,
    },
    webImportPreserveImages: true,
    webImportKeepRawSource: true,
    pdfSettings: {
      defaultZoom: 1.0,
      twoPageSpread: false,
      showOcrPageBreaks: false,
      preferredMobileMode: "auto",
      reflowFontFamily: "serif",
      reflowFontSize: 19,
      reflowLineHeight: 1.72,
      reflowMargin: 16,
      reflowDirection: "auto",
      reflowImageScaling: "fit",
      reflowTheme: "system",
      fixedMobileMode: "fit-width",
      fixedColumns: 1,
      fixedColumnDirection: "ltr",
      fixedColumnOverlap: 0.08,
    },
    epubSettings: {
      fontSize: 16,
      fontFamily: "serif",
      lineHeight: 1.6,
      autoScroll: true,
    },
    htmlSettings: {
      fontSize: 16,
      fontFamily: "serif",
      lineHeight: 1.6,
    },
    segmentation: {
      method: "semantic",
      targetLength: 200,
      overlap: 20,
    },
    ocr: {
      provider: "tesseract",
      language: "eng",
      autoOCR: false,
      tesseract_path: undefined,
      googleProjectId: undefined,
      googleLocation: "us",
      googleProcessorId: undefined,
      googleCredentialsPath: undefined,
      awsRegion: "us-east-1",
      awsAccessKey: undefined,
      awsSecretKey: undefined,
      azureEndpoint: undefined,
      azureApiKey: undefined,
      marker_path: undefined,
      nougat_path: undefined,
      glmEndpoint: "http://localhost:11434/v1",
      glmModel: "",
      glmApiKey: undefined,
      glmBackend: "ollama",
      glmOllamaPath: undefined,
      mistralApiKey: undefined,
      preferLocal: true,
      preferWindowsSystemOcr: false,
      mathOcrEnabled: false,
      mathOcrCommand: "nougat",
      mathOcrModelDir: undefined,
      keyPhraseExtraction: false,
      autoExtractOnLoad: false,
    },
    cacheContent: true,
    autoCleanupCache: false,
  },
  ai: {
    enabled: false,
    provider: "openai",
    model: "gpt-4o-mini",
    temperature: 0.7,
    maxTokens: 4096,
    pwaAssistantButtonEnabled: false,
    pwaAssistantButtonSide: "right",
    preferOnDevice: true,
    // ai-billing-safety (#14): cloud fallback after an on-device failure is an
    // explicit opt-in. Default OFF — an on-device failure must not silently
    // send content to a paid cloud provider.
    allowCloudFallback: false,
    assistantUseAppleFoundation: false,
    // Active recall ships dark (design D19: off is the default + kill switch).
    activeRecallMode: "off",
    aiControls: {
      autoGenerate: false,
      cardsPerExtract: 5,
      qualityThreshold: 0.0,
      requireApproval: false,
      autoSummarize: false,
      summaryLength: "medium",
      includeSummaryInCards: false,
      maxTokensPerRequest: 4096,
      contextFromRelatedCards: false,
      documentSnippetLength: 2000,
      flashcardCountMode: "fixed",
      flashcardFixedCount: 5,
      flashcardAutoMin: 3,
      flashcardAutoMax: 25,
    },
    memoryEnabled: false,
  },
  importExport: {
    autoBackup: false,
    backupInterval: 86400,
    includeMedia: false,
  },
  notifications: {
    enabled: false,
    studyReminders: false,
    reminderTime: "09:00",
    dueDateReminders: true,
    soundEnabled: true,
    notificationSound: "default",
    soundVolume: 0.5,
    quietHoursEnabled: false,
    quietHoursStart: "22:00",
    quietHoursEnd: "08:00",
    showBadge: true,
    feedbackSoundsEnabled: false,
    feedbackVolume: 0.3,
  },
  privacy: {
    telemetryEnabled: false,
    crashReportsEnabled: false,
    analyticsEnabled: false,
  },
  search: {
    systemSpotlightEnabled: false,
  },
  audioTranscription: {
    provider: "local",
    mode: "auto",
    sttProvider: "automatic",
    sttModel: "automatic",
    preferLocal: true,
    automaticFallback: true,
    openrouter: {
      defaultModel: "nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b",
    },
    preferAndroidSpeech: true,
    autoTranscription: false,
    autoTranscribeLocalVideos: true,
    preferredModelId: "distil-small.en",
    language: "en",
    timestampGeneration: true,
    speakerDiarization: false,
    confidenceScores: false,
    confidenceThreshold: 0.7,
    groq: {
      apiKey: "",
      model: "whisper-large-v3-turbo",
      useFreeTier: true,
      usage: {
        lastResetDate: new Date().toISOString(),
        audioSecondsProcessed: 0,
        requestsMade: 0,
      },
    },
    // Android on-device STT: ships dark — the resolver only picks it once a
    // model is downloaded and the user enables it (or via on-device default).
    androidOnDevice: {
      modelId: "",
      pacing: "capped",
    },
    premiumMinutesUsed: 0,
    premiumMonthlyAllowance: 120,
    deepgram: {
      apiKey: "",
    },
  },
  smartQueue: {
    autoRefresh: false,
    refreshInterval: 60,
    queueStrategyPreset: "maximize-retention",
    sessionItemTypes: {
      documents: true,
      extracts: true,
      learningItems: true,
    },
  },
  tts: createDefaultTTSSettings(),
  scrollQueue: {
    composition: { documents: 60, extracts: 15, flashcards: 25 },
    autoProceed: false, // Auto-proceed to next item in the queue when a video/audio ends
    ratingOrbsPosition: "right", // Snapped position of rating orbs
  },
  rssQueue: {
    includeInQueue: true,
    percentage: 20, // 20% of queue should be RSS by default
    maxItemsPerSession: 10, // Max 10 RSS items per session
    maxItemAgeDays: 2, // Hide RSS items older than 2 days by default
    includedFeedIds: [], // Empty = all feeds included by default
    excludedFeedIds: [], // No feeds excluded by default
    unreadOnly: true, // Only include unread items
    preferRecent: true, // Prefer newer items
    showCoverImage: false, // Hide cover images by default
  },
  podcastQueue: {
    includeInQueue: false,
    maxItemsPerSession: 10,
    unreadOnly: true,
  },
  rssSummary: {
    mode: "modern",
    defaultLength: "medium",
    defaultFocus: "key-points",
    panelWidth: 320,
    panelPosition: "right",
    autoOpen: false,
  },
  youtube: {
    apiKey: undefined,
    enabled: false,
    transcriptServerUrl: undefined,
    transcriptServerApiKey: undefined,
    transcriptOnDeviceEnabled: true,
  },
  features: {
    notebooklmEnabled: false,
    fsrsScopedParametersEnabled: true,
    reviewUndoEnabled: true,
    cramModeEnabled: true,
    // AI Learning System features (enabled by default)
    aiLearnThis: true,
    aiOcclusionAssist: true,
    aiOcclusionFreeform: false,
    aiSemanticIndex: true,
    aiLibraryRag: true,
    aiActiveRecall: true,
    aiAnswerAssessment: true,
    aiAutoGradeSuggest: false,
    aiPrerequisites: true,
    aiConceptLinks: true,
    aiExtractWorthiness: true,
    aiSocraticTutor: true,
    aiAgent: true,
    androidAppSearchIndex: true,
    // QA soak phase (overhaul-reader-selection-ux task 7.8, first half): the
    // controller is now the default path on all reader surfaces.
    selectionInteractionV2: true,
    dictionaryPeek: true,
    appleFoundationModels: true,
    appleSpotlightIndex: true,
    appleSpeechTranscription: true,
    appleVisionScan: true,
    appleNaturalLanguageEmbeddings: true,
    appleCoreAI: false,
    windowsSystemAi: true,
    windowsAiExperimental: false,
  },
  foundryLocal: {
    enabled: false,
    baseUrl: "http://127.0.0.1:52725",
    model: "",
  },
  audioReviewMode: {
    enabled: false,
    autoFlip: true,
    autoFlipDelayMs: 1500,
    defaultRating: 3,
    algorithmArenaCoachCompleted: false,
  },
  embedding: {
    provider: "openai",
    openaiModel: "text-embedding-3-small",
    cohereModel: "embed-english-v3.0",
    openrouterModel: "openai/text-embedding-3-small",
    ollamaBaseUrl: "http://localhost:11434",
    ollamaModel: "nomic-embed-text",
    chunkSize: 200,
    chunkOverlap: 20,
    topK: 8,
    minSimilarity: 0.25,
    // Explicit enablement for billable cloud embeddings (ai-billing-safety):
    // an API key authorizes, it does not consent. Off by default.
    paidEmbeddingsEnabled: false,
  },
  handsFreeStudy: DEFAULT_HANDS_FREE_STUDY_SETTINGS,
  languageLearning: {
    enabled: false,
    suggestionsEnabled: true,
    showUnavailableProviders: true,
  },
  plethora: {
    overrides: {},
  },
};

/**
 * Settings Store State
 */
interface SettingsState {
  settings: Settings;
  updateSettings: (updates: Partial<Settings>) => void;
  updateSettingsCategory: <K extends keyof Settings>(
    category: K,
    updates: Partial<Settings[K]>
  ) => void;
  resetSettings: () => void;
  resetCategory: <K extends keyof Settings>(category: K) => void;
}

/**
 * Settings Store
 */
export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: defaultSettings,

      updateSettings: (updates) =>
        set((state) => {
          const nextLearning =
            updates.learning && "algorithm" in updates.learning
              ? {
                  ...updates.learning,
                  algorithm: normalizeSchedulerId(String(updates.learning.algorithm)),
                }
              : updates.learning;
          return {
            settings: {
              ...state.settings,
              ...updates,
              ...(nextLearning ? { learning: { ...state.settings.learning, ...nextLearning } } : {}),
            },
          };
        }),

      updateSettingsCategory: (category, updates) =>
        set((state) => {
          const nextCategory =
            category === "learning" && updates && "algorithm" in updates
              ? {
                  ...updates,
                  algorithm: normalizeSchedulerId(String(updates.algorithm)),
                }
              : updates;
          return {
            settings: {
              ...state.settings,
              [category]: {
                ...state.settings[category],
                ...nextCategory,
                // The sidebar width is user-facing only within its min/max range;
                // clamp here (single source of truth) so the toolbar CSS variable
                // and any other consumer never see an out-of-range value.
                ...(category === "interface" && "sidebarWidth" in updates
                  ? { sidebarWidth: clampSidebarWidth(updates.sidebarWidth) }
                  : {}),
              },
            },
          };
        }),

      resetSettings: () => set({ settings: defaultSettings }),

      resetCategory: (category) =>
        set((state) => ({
          settings: {
            ...state.settings,
            [category]: { ...defaultSettings[category] },
          },
        })),
    }),
    {
      name: "plethora-settings",
      version: 13,
      // Dual-read window (rebrand task 3.3): if the pre-migration key is
      // still present (migration could not run or was interrupted), read
      // through to it so settings survive.
      storage: createJSONStorage(() => ({
        getItem: (name: string) => migratedGetItem(name),
        setItem: (name: string, value: string) => {
          try { localStorage.setItem(name, value); } catch { /* full */ }
        },
        removeItem: (name: string) => {
          try { localStorage.removeItem(name); } catch { /* blocked */ }
        },
      })),
      migrate: (persisted: unknown, version: number) => {
        const p = (persisted ?? {}) as Partial<Settings> & { settings?: Partial<Settings> };
        const root = p.settings ?? p;
        // v2 -> v3: the floating Document Assistant mic orb used to default to ON.
        // It eats screen space and most users never used it, so it now defaults to
        // OFF and is opt-in via Settings → AI. Reset any previously persisted value
        // so existing users also get the new default.
        if (root?.ai && version < 3) {
          root.ai.pwaAssistantButtonEnabled = false;
        }
        // v4 -> v5: animated themes are now gated by `interface.animationsEnabled`
        // instead of being hardcoded off on native mobile. To preserve the
        // mobile behavior users actually experienced (no animation, to avoid
        // sustained GPU load/heating), default the toggle to false on native
        // mobile. Desktop keeps the default true. This only runs on migration
        // from < v5, so an explicit later choice is never overridden.
        if (version < 5) {
          if (root?.interface && isNativeMobile()) {
            root.interface.animationsEnabled = false;
          }
        }
        // v5 -> v6: the flashcard generation target replaces the narrower
        // `cardsPerExtract` field, which only ever fed extract auto-generation.
        // Seed the new fixed-count field from the user's prior value so
        // behavior is unchanged until they touch the new setting.
        if (version < 6) {
          const priorCards = root?.ai?.aiControls?.cardsPerExtract;
          if (root?.ai?.aiControls && typeof priorCards === "number") {
            root.ai.aiControls.flashcardFixedCount = priorCards;
          }
        }
        // v6 -> v7: plethora commercial product foundation (dev grants / capability overrides).
        if (version < 7) {
          if (root && !root.plethora) {
            root.plethora = { overrides: {} };
          }
        }
        // v7 -> v8 (ai-billing-safety #14): paid/cloud embeddings and TTS are
        // now explicit opt-ins. Existing users keep their configured providers
        // but never implicitly consent to billing — both flags default false.
        if (version < 8) {
          if (root?.embedding && typeof root.embedding.paidEmbeddingsEnabled !== "boolean") {
            root.embedding.paidEmbeddingsEnabled = false;
          }
          if (root?.tts && typeof root.tts.paidTtsEnabled !== "boolean") {
            root.tts.paidTtsEnabled = false;
          }
        }
        // v8 -> v9: Android on-device speech + AppSearch ship ON so a Pixel
        // install uses them without hunting for hidden flags. Cloud fallback
        // stays off. Existing testers who still have the old false defaults
        // are flipped on once; later explicit opt-outs persist at version 9+.
        if (version < 9) {
          if (root?.audioTranscription) {
            root.audioTranscription.preferAndroidSpeech = true;
          }
          if (root?.features) {
            root.features.androidAppSearchIndex = true;
          }
        }
        // v9 -> v10 (android-on-device-transcription): the on-device STT
        // engine gains settings (model + thermal pacing). Defaults keep
        // current behavior — the resolver only routes to it after a model is
        // downloaded, so nothing changes until the user opts in.
        if (version < 10) {
          if (root?.audioTranscription && !root.audioTranscription.androidOnDevice) {
            root.audioTranscription.androidOnDevice = { modelId: "", pacing: "capped" };
          }
        }
        // v10 -> v11 (language-learning opt-in): Language Learning becomes an
        // explicit opt-in feature. No persisted master-opt-in state existed
        // before v11 — `suggestionsEnabled: true` was an unwired presentation
        // default, never a user choice — so every existing install migrates
        // to `enabled: false`. The sub-flags keep their prior values.
        if (version < 11) {
          const prior = root?.languageLearning as Partial<LanguageLearningSettings> | undefined;
          root.languageLearning = {
            enabled: false,
            suggestionsEnabled: prior?.suggestionsEnabled ?? true,
            showUnavailableProviders: prior?.showUnavailableProviders ?? true,
          };
        }
        // v11 -> v12 (speech-to-text platform): add transcription mode; map legacy provider.
        if (version < 12) {
          if (root?.audioTranscription && !root.audioTranscription.mode) {
            const provider = root.audioTranscription.provider;
            root.audioTranscription.mode =
              provider === "local"
                ? "offline"
                : provider === "groq"
                  ? "fast"
                  : "auto";
          }
        }
        // v12 -> v13 (STT provider/model UX): add sttProvider, sttModel, preferLocal, fallback.
        if (version < 13) {
          const audio = root?.audioTranscription;
          if (audio) {
            if (!audio.sttProvider) {
              const mode = audio.mode ?? "auto";
              audio.sttProvider =
                mode === "offline" || audio.provider === "local"
                  ? "local"
                  : mode === "fast" || audio.provider === "groq"
                    ? "openrouter"
                    : mode === "enhanced" || mode === "realtime"
                      ? "premium"
                      : "automatic";
            }
            if (!audio.sttModel) audio.sttModel = "automatic";
            if (typeof audio.preferLocal !== "boolean") audio.preferLocal = true;
            if (typeof audio.automaticFallback !== "boolean") audio.automaticFallback = true;
            if (!audio.openrouter) {
              audio.openrouter = {
                defaultModel: "nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b",
              };
            }
          }
        }
        return persisted as SettingsState;
      },
      onRehydrateStorage: () => (state, error) => {
        if (error || !state) return;
        const persisted = state.settings || defaultSettings;
        // Pre-rename persistence used the legacy scheduler's prefixed learning
        // keys; they are migrated into the current fields below. Their literal
        // names live in the exempt schedulerIdentity module.
        const legacyLearning = persisted.learning as
          | (LearningSettings & Record<string, unknown>)
          | undefined;
        const legacyPureKernel = legacyLearning?.[LEGACY_LEARNING_KEYS.pureKernel] as
          | boolean
          | undefined;
        const legacyArenaMode = legacyLearning?.[LEGACY_LEARNING_KEYS.arenaReviewMode] as
          | string
          | undefined;
        const persistedFsrsParams = persisted.learning?.fsrsParams;
        const normalizedGlobalWeights = normalizeFsrsParameters(
          persistedFsrsParams?.personalizedWeights
        );
        const normalizedScopedOverrides = Array.isArray(persisted.learning?.scopedFsrsOverrides)
          ? persisted.learning.scopedFsrsOverrides.map((entry) => ({
              ...entry,
              personalizedWeights: normalizeFsrsParameters(entry.personalizedWeights),
            }))
          : defaultSettings.learning.scopedFsrsOverrides;
        const merged: Settings = {
          ...defaultSettings,
          ...persisted,
          general: { ...defaultSettings.general, ...persisted.general },
          appearance: { ...defaultSettings.appearance, ...persisted.appearance },
          interface: {
            ...defaultSettings.interface,
            ...persisted.interface,
            sidebarWidth: clampSidebarWidth(persisted.interface?.sidebarWidth),
            companion: {
              ...DEFAULT_COMPANION_SETTINGS,
              ...(persisted.interface?.companion ?? {}),
            },
          },
          learning: {
            ...defaultSettings.learning,
            ...persisted.learning,
            algorithm: normalizeSchedulerId(
              persisted.learning?.algorithm ?? defaultSettings.learning.algorithm,
            ),
            fsrsParams: {
              ...defaultSettings.learning.fsrsParams,
              ...persistedFsrsParams,
              personalizedWeights: normalizedGlobalWeights,
            },
            scopedFsrsOverrides: normalizedScopedOverrides,
            precisionPureKernel:
              persisted.learning?.precisionPureKernel ??
              legacyPureKernel ??
              defaultSettings.learning.precisionPureKernel,
            arenaReviewMode:
              persisted.learning?.arenaReviewMode === "choose" ||
              legacyArenaMode === "choose"
                ? "choose"
                : defaultSettings.learning.arenaReviewMode,
          },
          documents: {
            ...defaultSettings.documents,
            ...persisted.documents,
            pdfSettings: {
              ...defaultSettings.documents.pdfSettings,
              ...persisted.documents?.pdfSettings,
            },
            epubSettings: {
              ...defaultSettings.documents.epubSettings,
              ...persisted.documents?.epubSettings,
            },
            htmlSettings: {
              ...defaultSettings.documents.htmlSettings,
              ...persisted.documents?.htmlSettings,
            },
            segmentation: {
              ...defaultSettings.documents.segmentation,
              ...persisted.documents?.segmentation,
            },
            ocr: {
              ...defaultSettings.documents.ocr,
              ...persisted.documents?.ocr,
            },
            smartTagging: {
              ...defaultSettings.documents.smartTagging,
              ...persisted.documents?.smartTagging,
            },
          },
          ai: {
            ...defaultSettings.ai,
            ...persisted.ai,
            aiControls: { ...defaultSettings.ai.aiControls, ...persisted.ai?.aiControls },
            // Defensive: an unknown persisted mode (older/newer schema) resets
            // to the safe default instead of enabling prompts accidentally.
            activeRecallMode: normalizeActiveRecallMode(persisted.ai?.activeRecallMode),
          },
          importExport: { ...defaultSettings.importExport, ...persisted.importExport },
          notifications: { ...defaultSettings.notifications, ...persisted.notifications },
          privacy: { ...defaultSettings.privacy, ...persisted.privacy },
          search: { ...defaultSettings.search, ...persisted.search },
          audioTranscription: {
            ...defaultSettings.audioTranscription,
            ...persisted.audioTranscription,
            groq: {
              ...defaultSettings.audioTranscription.groq,
              ...persisted.audioTranscription?.groq,
              usage: {
                ...defaultSettings.audioTranscription.groq.usage,
                ...persisted.audioTranscription?.groq?.usage,
              },
            },
            deepgram: {
              ...defaultSettings.audioTranscription.deepgram,
              ...persisted.audioTranscription?.deepgram,
            },
          },
          smartQueue: { ...defaultSettings.smartQueue, ...persisted.smartQueue },
          tts: (() => {
            const sanitized = sanitizeTTSSettings(persisted.tts);
            // Field diagnostic (rides the Android consoleLogcatBridge): TTS
            // provider settings were reported resetting across restarts. This
            // one line distinguishes "storage lost the value" from
            // "hydration dropped it" — compare against what the settings UI
            // showed before the restart.
            const persistedOpenrouter = (persisted.tts as { providers?: Record<string, { modelId?: string; voiceId?: string }> } | undefined)
              ?.providers?.openrouter;
            console.info(
              "[settings] tts hydration:",
              `provider=${sanitized.provider}`,
              `openrouter.persisted=${JSON.stringify(persistedOpenrouter ?? null)}`,
              `openrouter.hydrated=${JSON.stringify(
                { modelId: sanitized.providers.openrouter?.modelId, voiceId: sanitized.providers.openrouter?.voiceId }
              )}`
            );
            return sanitized;
          })(),
          scrollQueue: mergeScrollQueueSettings(persisted.scrollQueue),
          rssQueue: { ...defaultSettings.rssQueue, ...persisted.rssQueue },
          podcastQueue: { ...defaultSettings.podcastQueue, ...persisted.podcastQueue },
          rssSummary: { ...defaultSettings.rssSummary, ...persisted.rssSummary },
          youtube: { ...defaultSettings.youtube, ...persisted.youtube },
          features: { ...defaultSettings.features, ...persisted.features },
          foundryLocal: {
            ...defaultSettings.foundryLocal,
            ...persisted.foundryLocal,
            model:
              persisted.foundryLocal?.model ??
              (persisted.foundryLocal as { modelAlias?: string } | undefined)?.modelAlias ??
              defaultSettings.foundryLocal.model,
          },
          audioReviewMode: { ...defaultSettings.audioReviewMode, ...persisted.audioReviewMode },
          embedding: { ...defaultSettings.embedding, ...persisted.embedding },
          handsFreeStudy: mergeHandsFreeStudySettings(persisted.handsFreeStudy),
          languageLearning: {
            ...defaultSettings.languageLearning,
            ...persisted.languageLearning,
          },
          plethora: {
            ...defaultSettings.plethora,
            ...persisted.plethora,
            overrides: {
              ...(defaultSettings.plethora?.overrides ?? {}),
              ...(persisted.plethora?.overrides ?? {}),
            },
          },
        };

        if (!Array.isArray(merged.learning.lapseSteps)) {
          merged.learning.lapseSteps = defaultSettings.learning.lapseSteps;
        }
        if (!Array.isArray(merged.rssQueue.includedFeedIds)) {
          merged.rssQueue.includedFeedIds = [];
        }
        if (!Array.isArray(merged.rssQueue.excludedFeedIds)) {
          merged.rssQueue.excludedFeedIds = [];
        }
        if (
          typeof merged.rssQueue.maxItemAgeDays !== "number" ||
          merged.rssQueue.maxItemAgeDays < 0
        ) {
          merged.rssQueue.maxItemAgeDays = defaultSettings.rssQueue.maxItemAgeDays;
        }
        if (!merged.documents.ocr.language) {
          merged.documents.ocr.language = defaultSettings.documents.ocr.language;
        }

        // Fresh native-mobile installs: there is no persisted `animationsEnabled`
        // (the field defaulted to true), but animated backdrops were historically
        // hardcoded off on mobile to avoid heating. Preserve that default on a
        // first mobile run — but only when the user has never set the value, so a
        // later explicit choice (either way) is always honored.
        if (
          isNativeMobile() &&
          persisted.interface?.animationsEnabled === undefined
        ) {
          merged.interface.animationsEnabled = false;
        }
        // Companion ships OFF by default everywhere; native-mobile users who
        // never touched the setting stay off regardless of future defaults.
        if (isNativeMobile() && persisted.interface?.companion === undefined) {
          merged.interface.companion = { ...DEFAULT_COMPANION_SETTINGS, enabled: false };
        }

        state.settings = merged;
      },
    }
  )
);
