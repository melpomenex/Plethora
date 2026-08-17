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
import type { ActiveRecallMode } from "../lib/ai/recall/interruptionPolicy";

export type { ActiveRecallMode };

/** Valid `ai.activeRecallMode` values (unknown persisted values reset to off). */
const ACTIVE_RECALL_MODES: readonly ActiveRecallMode[] = ["off", "low", "adaptive", "intensive"];

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
 * Postpone Settings (SM-20 algorithm-aware postponement)
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
  // Must mirror the variants of `AlgorithmType` in
  // src-tauri/src/algorithms/mod.rs (which `from_str_lossy` falls back to Fsrs
  // for anything unrecognized). Keep these in sync.
  algorithm: "fsrs" | "sm2" | "sm5" | "sm8" | "sm15" | "sm18" | "sm20";
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
  sm20PureM4: boolean;
  /** Whether SM-20 commits Arena Pick immediately or opens the post-grade chooser. */
  sm20ArenaReviewMode: "automatic" | "choose";
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
  provider: "tesseract" | "google" | "aws" | "azure" | "marker" | "nougat" | "glm" | "mistral";
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
  cacheContent: boolean;
  autoCleanupCache: boolean;
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

interface InterfaceSettings {
  showSidebar: boolean;
  showStats: boolean;
  compactMode: boolean;
  /** Use the dense library cockpit layout in Documents. */
  compactDocumentsView: boolean;
  animationsEnabled: boolean;
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
   * Prefer on-device inference (Gemini Nano) over a cloud provider when it is
   * available. Android-only in effect: everywhere else the on-device bridge
   * reports `platform_unsupported` and this setting changes nothing.
   */
  preferOnDevice: boolean;
  /**
   * Whether an on-device failure may automatically retry on a configured
   * cloud provider (design D27). Default true (matches the long-standing
   * `runAiAction` fallback-with-toast behavior); turning it off is the
   * "on-device only" lock — no AI content ever leaves the device.
   */
  allowCloudFallback: boolean;
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
  provider: "local" | "groq";
  autoTranscription: boolean;
  autoTranscribeLocalVideos: boolean;
  preferredModelId?: string;
  language: string;
  timestampGeneration: boolean;
  speakerDiarization: boolean;
  confidenceScores: boolean;
  confidenceThreshold: number;
  groq: GroqTranscriptionSettings;
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
   * Selection-interaction controller v2 (OpenSpec
   * `overhaul-reader-selection-ux`): stability-gated selection UI, anchored
   * action bar, snapshot-owned action lifecycle. Ships dark; rollback =
   * disable the flag (old paths remain until the flag is removed).
   */
  selectionInteractionV2: boolean;
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
  audioTranscription: AudioTranscriptionSettings;
  smartQueue: SmartQueueSettings;
  tts: TTSSettings;
  scrollQueue: ScrollQueueSettings;
  rssQueue: RSSQueueSettings;
  podcastQueue: PodcastQueueSettings;
  rssSummary: RSSSummarySettings;
  youtube: YouTubeSettings;
  features: FeatureFlags;
  audioReviewMode: AudioReviewModeSettings;
  embedding: EmbeddingSettings;
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
    fontFamily: "Inter",
  },
  interface: {
    showSidebar: true,
    showStats: true,
    compactMode: false,
    compactDocumentsView: false,
    animationsEnabled: true,
    animationFrequency: 1,
    animationBrightness: 12,
    reviewZenMode: false,
    conversationalReviewEnabled: true,
    toolbarPosition: "left",
    splitViewSpawn: { button: 1, modifier: "none" },
    volumeRockerScroll: "none",
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
    sm20PureM4: false,
    sm20ArenaReviewMode: "automatic",
  },
  documents: {
    defaultCategory: "Uncategorized",
    autoProcessOnImport: false,
    detectDuplicates: true,
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
    allowCloudFallback: true,
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
  audioTranscription: {
    provider: "local",
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
    // QA soak phase (overhaul-reader-selection-ux task 7.8, first half): the
    // controller is now the default path on all reader surfaces.
    selectionInteractionV2: true,
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
        set((state) => ({
          settings: { ...state.settings, ...updates },
        })),

      updateSettingsCategory: (category, updates) =>
        set((state) => ({
          settings: {
            ...state.settings,
            [category]: { ...state.settings[category], ...updates },
          },
        })),

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
      version: 6,
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
        return persisted as SettingsState;
      },
      onRehydrateStorage: () => (state, error) => {
        if (error || !state) return;
        const persisted = state.settings || defaultSettings;
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
          interface: { ...defaultSettings.interface, ...persisted.interface },
          learning: {
            ...defaultSettings.learning,
            ...persisted.learning,
            fsrsParams: {
              ...defaultSettings.learning.fsrsParams,
              ...persistedFsrsParams,
              personalizedWeights: normalizedGlobalWeights,
            },
            scopedFsrsOverrides: normalizedScopedOverrides,
            sm20PureM4: persisted.learning?.sm20PureM4 ?? defaultSettings.learning.sm20PureM4,
            sm20ArenaReviewMode:
              persisted.learning?.sm20ArenaReviewMode === "choose"
                ? "choose"
                : defaultSettings.learning.sm20ArenaReviewMode,
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
          },
          smartQueue: { ...defaultSettings.smartQueue, ...persisted.smartQueue },
          tts: sanitizeTTSSettings(persisted.tts),
          scrollQueue: mergeScrollQueueSettings(persisted.scrollQueue),
          rssQueue: { ...defaultSettings.rssQueue, ...persisted.rssQueue },
          podcastQueue: { ...defaultSettings.podcastQueue, ...persisted.podcastQueue },
          rssSummary: { ...defaultSettings.rssSummary, ...persisted.rssSummary },
          youtube: { ...defaultSettings.youtube, ...persisted.youtube },
          features: { ...defaultSettings.features, ...persisted.features },
          audioReviewMode: { ...defaultSettings.audioReviewMode, ...persisted.audioReviewMode },
          embedding: { ...defaultSettings.embedding, ...persisted.embedding },
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

        state.settings = merged;
      },
    }
  )
);
