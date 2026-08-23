/**
 * Settings System Types
 * Based on Incrementum-CPP SettingsDialog.cpp
 */

import type { TTSSettings as ModernTTSSettings } from "../utils/ttsSettings";

// General Settings
export interface GeneralSettings {
  autoSaveMinutes: number;
  maxRecentDocuments: number;
  defaultCategory: string;
  showStatsOnStartup: boolean;
  restoreSession: boolean;
}

// Interface Settings
export interface InterfaceSettings {
  theme: string;
  denseMode: boolean;
  /** Use the dense library cockpit layout in Documents. */
  compactDocumentsView: boolean;
  toolbarIconSize: number;
  showStatistics: boolean;
  hintMode: boolean;
  hintModePersistent: boolean;
  /** Expanded sidebar (toolbar rail) width in px (clamped to 128–320). */
  sidebarWidth: number;
}

// Document Settings
export interface DocumentSettings {
  autoSegment: boolean;
  autoHighlight: boolean;
  segmentSize: number;
  segmentStrategy: "semantic" | "paragraph" | "fixed" | "smart";
  highlightColor: 0 | 1 | 2 | 3 | 4;
  ocr: {
    enabled: boolean;
    provider: "google" | "aws" | "mistral" | "mathpix" | "gpt4o" | "claude" | "local";
    apiKey: string;
    preferLocal: boolean;
  };
  mathOcr: {
    enabled: boolean;
    command: string;
    args: string;
    modelDir: string;
    modelUrl: string;
  };
  smartTagging: SmartTaggingSettings;
}

export interface SmartTaggingSettings {
  enabled: boolean;
  mode: "automatic" | "suggestions-only";
  maxTagsPerDocument: number;
  preferExistingTags: boolean;
}

// Learning Settings
export interface LearningSettings {
  minInterval: number;
  maxInterval: number;
  retention: number;
  intervalModifier: number;
  chunkSchedulingDefault: string;
  interleavedQueueMode: boolean;
  interleavedQueueRatio: number;
  /** Whether to show collapsible source context on review cards. */
  showSourceContext: boolean;
  /** Weekdays (0=Sun..6=Sat) on which to suppress new reviews (Easy Days). */
  easyDays: number[];
  /** Whether to redistribute due reviews to smooth daily load (load balancing). */
  loadBalancingEnabled: boolean;
}

// Algorithm Settings
export interface AlgorithmSettings {
  type: "fsrs" | "sm2" | "sm18" | "sm20";
  desiredRetention: number;
  maxRetention: number;
  weightsHalfLife: number;
  forgettingCurveHalfLife: number;
  stability: number;
  difficulty: number;
  globalForgettingIndex: number;
  useCategoryForgettingIndex: boolean;
  categoryForgettingIndexes: Record<string, number>;
}

/** Configuration for the hands-free audio read-aloud review mode. */
export interface AudioReviewModeSettings {
  enabled: boolean;
  autoFlip: boolean;
  autoFlipDelayMs: number;
  defaultRating: 1 | 2 | 3 | 4;
  algorithmArenaCoachCompleted?: boolean;
}

/** Embedding provider/model for whole-library RAG chat. */
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
   * Explicit consent to billable (cloud) embeddings (ai-billing-safety). An
   * API key authorizes, it does not consent. Default false; gates indexing,
   * per-chunk embedding jobs, query-side `embed_text` and semantic-graph
   * embedding for OpenAI/Cohere/OpenRouter.
   */
  paidEmbeddingsEnabled: boolean;
}

// Automation Settings
export interface AutomationSettings {
  autoSync: boolean;
  desktopNotifications: boolean;
  backgroundProcessing: boolean;
  notificationInterval: number;
}

// Sync Settings
export interface SyncSettings {
  browser: {
    enabled: boolean;
    port: number;
  };
  vps: {
    url: string;
    apiKey: string;
    autoPoll: boolean;
  };
  desktop: {
    enabled: boolean;
    onStartup: boolean;
    intervalMinutes: number;
    lastSync: number;
  };
}

// API Settings
export interface APISettings {
  qa: {
    provider: string;
    apiKey: string;
    endpoint: string;
    model: string;
  };
  localLLM: {
    enabled: boolean;
    model: string;
    endpoint: string;
  };
  transcription: {
    provider: string;
    apiKey: string;
    endpoint: string;
  };
  localWhisper: {
    enabled: boolean;
    model: string;
  };
}

// QA Settings
export interface QASettings {
  autoGeneration: boolean;
  maxQuestions: number;
  difficulty: "easy" | "medium" | "hard" | "adaptive";
  systemPrompt: string;
  contextWindow: boolean;
  contextWindowSize: number;
  maxHistory: number;
  fromHighlights: boolean;
  fromSegments: boolean;
}

// Groq Transcription Settings
export interface GroqTranscriptionSettings {
  apiKey: string;
  model: "whisper-large-v3" | "whisper-large-v3-turbo";
  useFreeTier: boolean;
  // Usage tracking (reset monthly)
  usage: {
    lastResetDate: string;
    audioSecondsProcessed: number;
    requestsMade: number;
  };
}

// Audio Transcription Settings
export interface AudioTranscriptionSettings {
  provider: "local" | "groq" | "apple";
  autoTranscription: boolean;
  autoTranscribeLocalVideos: boolean;
  preferredModelId?: string;
  language: string;
  timestampGeneration: boolean;
  speakerDiarization: boolean;
  confidenceScores: boolean;
  confidenceThreshold: number;
  idleTranscriptionEnabled: boolean;
  idleThresholdMinutes: number;
  groq: GroqTranscriptionSettings;
}

export type TTSRequestMode = "direct" | "proxy";

export interface TTSPreset {
  id: string;
  name: string;
  description: string;
  prompt: string;
  temperature: number;
  topP: number;
  topK: number;
  repetitionPenalty: number;
  maxNewTokens: number;
  readonly: boolean;
}

export interface TTSVoiceProfile {
  id: string;
  provider: "fal" | "groq" | "pocket" | "system";
  name: string;
  kind: "builtin" | "cloned";
  voice?: string;
  speakerEmbeddingUrl?: string;
  referenceText?: string;
  createdAt: string;
}

export type TTSSettings = ModernTTSSettings;

// Integration Settings
export interface IntegrationSettings {
  obsidian: {
    enabled: boolean;
    vaultPath: string;
    template: string;
    dailyNotes: boolean;
    bidirectionalSync: boolean;
  };
  anki: {
    enabled: boolean;
    deckName: string;
    bidirectionalSync: boolean;
    syncEnabled: boolean;
    serverUrl: string;
    username: string;
    password: string;
    apiToken: string;
    useToken: boolean;
  };
  notebooklm: {
    enabled: boolean;
    provider: "mock" | "cli" | string;
    activeNotebookId: string;
    defaultDeckName: string;
    dedupeOnImport: boolean;
  };
}

// MCP Servers Settings
export interface MCPServerSettings {
  server1: {
    name: string;
    endpoint: string;
    transport: "stdio" | "sse";
  };
  server2: {
    name: string;
    endpoint: string;
    transport: "stdio" | "sse";
  };
  server3: {
    name: string;
    endpoint: string;
    transport: "stdio" | "sse";
  };
  autoConnect: boolean;
  connectionTimeout: number;
}

// Obsidian Integration Settings (Advanced)
export interface ObsidianIntegrationSettings {
  apiToken: string;
  databasePath: string;
  realTimeSync: boolean;
  conflictResolution: boolean;
  conflictStrategy: "local" | "remote" | "newer";
}

// RSS Settings
export interface RSSSettings {
  checkFrequency: number;
  appInterval: number;
  defaultPriority: number;
  maxItems: number;
  autoImport: boolean;
  autoCleanup: boolean;
  autoDismissOnScrollEnd: boolean;
  scrollEndAction: "dismiss" | "keep" | "ask";
  keepEntries: number;
}

// SponsorBlock Settings
export interface SponsorBlockSettings {
  enabled: boolean;
  autoSkip: boolean;
  notifications: boolean;
  privacyMode: boolean;
  categories: {
    sponsor: boolean;
    intro: boolean;
    outro: boolean;
    selfPromo: boolean;
    interaction: boolean;
    musicOfftopic: boolean;
    preview: boolean;
    filler: boolean;
  };
  cacheDuration: number;
}

// Smart Queue Settings
export interface SmartQueueSettings {
  autoRefresh: boolean;
  refreshInterval: number;
  queueStrategyPreset: string;
  /** Persisted item type preferences from Customize Queue modal */
  sessionItemTypes?: {
    documents?: boolean;
    extracts?: boolean;
    learningItems?: boolean;
  };
  /**
   * Whether the user has actually changed the Item Types toggles. Until they
   * have, each queue filter applies its own default (Due All shows every due
   * type; the narrower reading filters are documents-first) — one stored
   * `sessionItemTypes` object cannot express both.
   */
  sessionItemTypesCustomized?: boolean;
}

// RSS Summary Settings
export interface RSSSummarySettings {
  mode: "modern" | "terminal";
  defaultLength: "brief" | "medium" | "detailed";
  defaultFocus: "key-points" | "actionable" | "background";
  panelWidth: number;
  panelPosition: "left" | "right";
  autoOpen: boolean;
}

// Keybindings Settings
export interface KeybindingSettings {
  customBindings: Record<string, string>;
}

// Plethora Commercial Settings (dev grants, overrides)
export interface PlethoraSettings {
  overrides: Record<string, boolean>;
}

// Complete Settings Object
export interface Settings {
  general: GeneralSettings;
  interface: InterfaceSettings;
  documents: DocumentSettings;
  learning: LearningSettings;
  algorithm: AlgorithmSettings;
  automation: AutomationSettings;
  sync: SyncSettings;
  api: APISettings;
  qa: QASettings;
  audioTranscription: AudioTranscriptionSettings;
  tts: TTSSettings;
  integrations: IntegrationSettings;
  mcpServers: MCPServerSettings;
  obsidianIntegration: ObsidianIntegrationSettings;
  rss: RSSSettings;
  rssSummary: RSSSummarySettings;
  sponsorBlock: SponsorBlockSettings;
  smartQueue: SmartQueueSettings;
  keybindings: KeybindingSettings;
  audioReviewMode: AudioReviewModeSettings;
  embedding: EmbeddingSettings;
  plethora?: PlethoraSettings;
}

export type SettingsCategory = keyof Settings;

export type SettingsUpdate = Partial<Settings>;

export interface SettingsValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}
