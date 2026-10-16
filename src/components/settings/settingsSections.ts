/**
 * Shared Settings section metadata (revamp-command-palette-registry).
 *
 * The Settings page builds its tab list from this metadata, and the command
 * palette registers one `settings-section-<id>` command per entry. Keeping the
 * ids, label keys, and search keywords here means the palette never imports
 * the (lazy) Settings page chunk and the two cannot drift.
 */

export enum SettingsTab {
  Account = "account",
  General = "general",
  LanguageLearning = "language-learning",
  Appearance = "appearance",
  Learning = "learning",
  SmartQueue = "smart-queue",
  Documents = "documents",
  RSS = "rss",

  Shortcuts = "shortcuts",
  AI = "ai",
  AudioTranscription = "audio-transcription",
  TTS = "tts",
  Integrations = "integrations",
  CloudStorage = "cloud-storage",
  ImportExport = "import-export",
  Notifications = "notifications",
  Privacy = "privacy",
  Handbook = "handbook",
  Embeddings = "embeddings",
  Help = "help",
}

export interface SettingsSectionMetadata {
  id: SettingsTab;
  /** i18n key for the section label. */
  labelKey: string;
  /** Search keywords for the section (also used by the palette registry). */
  keywords: string[];
}

export const SETTINGS_SECTION_METADATA: SettingsSectionMetadata[] = [
  {
    id: SettingsTab.Account,
    labelKey: "settings.account",
    keywords: ["account", "profile", "pro", "upgrade", "subscription", "trial", "billing", "devices", "capabilities"],
  },
  {
    id: SettingsTab.General,
    labelKey: "settings.general",
    keywords: ["language", "startup", "default", "view", "auto-save", "backup", "data", "storage", "haptics", "haptic", "vibration", "feedback"],
  },
  {
    id: SettingsTab.LanguageLearning,
    labelKey: "settings.languageLearning",
    keywords: ["language", "learning", "profile", "target", "spanish", "japanese", "proficiency"],
  },
  {
    id: SettingsTab.Appearance,
    labelKey: "settings.appearance",
    keywords: [
      "theme",
      "color",
      "font",
      "size",
      "typography",
      "dark mode",
      "light mode",
      "display",
      "compact",
    ],
  },
  {
    id: SettingsTab.Learning,
    labelKey: "settings.learning",
    keywords: [
      "algorithm",
      "fsrs",
      "interval",
      "review",
      "flashcard",
      "retention",
      "difficulty",
      "scheduler",
    ],
  },
  {
    id: SettingsTab.SmartQueue,
    labelKey: "settings.smartQueues",
    // Adaptive ranking and decision models live in this section, so their search
    // terms belong here rather than on a tab that no longer exists.
    keywords: [
      "queue",
      "smart queue",
      "daqe",
      "adaptive",
      "ranking",
      "knobs",
      "decision model",
      "jev",
      "laya",
      "clef",
      "openrouter",
      "download model",
      "priority",
      "interleaving",
      "dwell",
      "auto-refresh",
    ],
  },
  {
    id: SettingsTab.Documents,
    labelKey: "settings.documents",
    keywords: ["import", "pdf", "epub", "reading", "extract", "annotation", "highlight", "tas", "tag", "scheduling", "prerequisite", "interference", "jitter", "maturity", "coherence"],
  },
  {
    id: SettingsTab.RSS,
    labelKey: "settings.rss",
    keywords: ["rss", "feed", "article", "retention", "cleanup", "keep", "subscription", "queue"],
  },
  {
    id: SettingsTab.Shortcuts,
    labelKey: "settings.shortcuts",
    keywords: ["keyboard", "hotkey", "keybinding", "shortcut", "command", "vim"],
  },
  {
    id: SettingsTab.AI,
    labelKey: "settings.ai",
    keywords: [
      "openai",
      "anthropic",
      "gemini",
      "nano",
      "ollama",
      "llm",
      "model",
      "token",
      "api key",
      "assistant",
      "flashcard generation",
      "learn this",
      "ask library",
      "socratic",
      "tutor",
      "ai learning",
      "on-device",
      "prerequisites",
      "active recall",
      "agent",
      "occlusion",
    ],
  },
  {
    id: SettingsTab.AudioTranscription,
    labelKey: "settings.audioTranscription",
    keywords: [
      "audio",
      "transcription",
      "whisper",
      "speech",
      "speech to text",
      "model",
      "download",
      "offline",
    ],
  },
  {
    id: SettingsTab.TTS,
    labelKey: "settings.tts",
    keywords: ["tts", "text to speech", "fal", "voice clone", "speech synthesis", "audio output"],
  },
  {
    id: SettingsTab.Integrations,
    labelKey: "settings.integrations",
    keywords: ["obsidian", "anki", "third-party", "extension", "browser", "plugin"],
  },
  {
    id: SettingsTab.CloudStorage,
    labelKey: "settings.cloudStorage",
    keywords: ["google drive", "dropbox", "onedrive", "backup", "cloud", "storage", "oauth"],
  },
  {
    id: SettingsTab.ImportExport,
    labelKey: "settings.importExport",
    keywords: ["data", "backup", "migration", "json", "csv", "archive", "transfer"],
  },
  {
    id: SettingsTab.Notifications,
    labelKey: "settings.notifications",
    keywords: ["reminder", "alert", "study", "due", "email", "push", "sound"],
  },
  {
    id: SettingsTab.Privacy,
    labelKey: "settings.privacy",
    keywords: ["security", "password", "encryption", "private", "data protection", "gdpr"],
  },
  {
    id: SettingsTab.Embeddings,
    labelKey: "settings.embeddings",
    keywords: ["embedding", "vector", "rag", "semantic", "retrieval", "index", "whole library", "chat"],
  },
  {
    id: SettingsTab.Handbook,
    labelKey: "settings.handbook",
    keywords: ["guide", "help", "tutorial", "documentation", "manual", "how to", "learn"],
  },
  {
    id: SettingsTab.Help,
    labelKey: "settings.help",
    keywords: ["tour", "onboarding", "replay", "reset", "walkthrough", "tutorial"],
  },
];
