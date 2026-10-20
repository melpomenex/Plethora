/**
 * Settings search coverage inventory (change: improve-settings-search).
 *
 * One row per reachable Settings section, naming the panel sources that own
 * the rendered controls, the catalog id prefixes that cover them, and the
 * deliberate exclusions. Tests assert that every shared section has an
 * inventory row and at least one catalog-backed destination, and that every
 * declared target id is produced by a real target primitive.
 *
 * This is a maintenance aid, not the whole coverage proof: the integration
 * tests mount Settings and assert real targets for critical controls, and the
 * catalog tests assert availability per platform/product state.
 */

import { SettingsTab } from "../settingsSections";

export interface SettingsSearchCoverageRow {
  readonly section: SettingsTab;
  readonly sources: readonly string[];
  readonly catalogPrefixes: readonly string[];
  /** Rendered controls/groups intentionally not indexed, with the reason. */
  readonly exclusions: readonly string[];
}

export const SETTINGS_SEARCH_COVERAGE: readonly SettingsSearchCoverageRow[] = [
  {
    section: SettingsTab.Account,
    sources: ["SettingsPage.tsx", "UserProfilePanel.tsx"],
    catalogPrefixes: ["section.account", "account."],
    exclusions: ["Hosted account controls are excluded when Plethora Cloud is unavailable."],
  },
  {
    section: SettingsTab.General,
    sources: ["SettingsPage.tsx", "HapticsSettingsControl.tsx", "ThirdPartyNoticesPanel.tsx"],
    catalogPrefixes: ["section.general", "general."],
    exclusions: [
      "Auto-save interval, backup-on-exit, and max backups are rendered disabled placeholders and are not indexed as configurable settings.",
      "The update check is gated by the app_updater platform capability.",
    ],
  },
  {
    section: SettingsTab.LanguageLearning,
    sources: ["LanguageLearningSettings.tsx"],
    catalogPrefixes: ["section.language-learning", "languageLearning."],
    exclusions: ["Per-profile archive controls are actions on user-created profiles, not configuration groups."],
  },
  {
    section: SettingsTab.Appearance,
    sources: ["SettingsPage.tsx", "ThemePicker.tsx", "EinkSettingsPanel.tsx"],
    catalogPrefixes: ["section.appearance", "appearance."],
    exclusions: [
      "Individual theme cards are a user-created/dynamic collection; the Theme group is the stable destination.",
      "Line Height is a disabled placeholder and is not indexed.",
      "Companion speech/comments/encouragement are indexed only while the companion is enabled.",
    ],
  },
  {
    section: SettingsTab.Learning,
    sources: ["LearningSettings.tsx"],
    catalogPrefixes: ["section.learning", "learning."],
    exclusions: [
      "Per-deck/tag override rows are user-created values; the scoped-overrides group is indexed when FSRS is active.",
      "The personal optimizer button is a consequential action, not a setting destination.",
    ],
  },
  {
    section: SettingsTab.SmartQueue,
    sources: ["SmartQueuesSettings.tsx"],
    catalogPrefixes: ["section.smart-queue", "smartQueue."],
    exclusions: [
      "Individual ranking knobs are one repeated editor template; the ranking group covers them.",
      "Model download controls are consequential actions and are reached through the ranking group, not invoked by search.",
    ],
  },
  {
    section: SettingsTab.Documents,
    sources: ["DocumentsSettings.tsx", "OCRSettings.tsx", "../tas/TASSettingsPanel.tsx"],
    catalogPrefixes: ["section.documents", "documents."],
    exclusions: [
      "OCR/TAS sub-panels expose their controls through the OCR group destination.",
      "Import buttons execute file pickers and are not search destinations.",
    ],
  },
  {
    section: SettingsTab.RSS,
    sources: ["RSSSettings.tsx", "RSSQueueSettings.tsx"],
    catalogPrefixes: ["section.rss", "rss."],
    exclusions: [
      "Per-feed include/exclude toggles are user subscription data; the feed-inclusions group is indexed.",
      "The nested queue configuration is reached through the RSS queue group.",
    ],
  },
  {
    section: SettingsTab.Shortcuts,
    sources: ["KeyboardShortcutsSettings.tsx"],
    catalogPrefixes: ["section.shortcuts", "shortcuts."],
    exclusions: ["Individual keybindings are user-edited shortcut rows; the group and Vim controls are indexed."],
  },
  {
    section: SettingsTab.AI,
    sources: [
      "AIProviderSettings.tsx",
      "FeatureReadinessPanel.tsx",
      "AIDiagnosticsModal.tsx",
      "LLMProviderSettings.tsx",
      "OnDeviceAiPanel.tsx",
      "MCPServersSettings.tsx",
    ],
    catalogPrefixes: ["section.ai", "ai."],
    exclusions: [
      "API key values, endpoints, and memory contents are private values and never enter the catalog.",
      "On-device AI entries are omitted where the platform bridge is unavailable.",
      "Consequential actions (test connection, enable all, run smoke test, export report) are revealed through their groups but are never executed or changed by search.",
      "Diagnostic provider/model strings and observed task payloads are runtime evidence, not searchable setting values.",
    ],
  },
  {
    section: SettingsTab.AudioTranscription,
    sources: ["AudioTranscriptionSettings.tsx", "OnDeviceAiPanel.tsx"],
    catalogPrefixes: ["section.audio-transcription", "audioTranscription."],
    exclusions: [
      "API key values and usage figures are private/runtime values and are not indexed.",
      "Download/delete model buttons are consequential actions; provider configuration groups are indexed.",
    ],
  },
  {
    section: SettingsTab.TTS,
    sources: ["TTSSettings.tsx", "VoiceBrowser.tsx", "AndroidTtsModelManager.tsx"],
    catalogPrefixes: ["section.tts", "tts."],
    exclusions: [
      "API keys, proxy URLs, and generated audio are private/runtime values.",
      "Provider-specific language/speed/system-voice rows are indexed only in the provider states that render them.",
      "Generate/preview/play controls execute actions and are never invoked by search.",
    ],
  },
  {
    section: SettingsTab.Integrations,
    sources: ["IntegrationSettings.tsx", "NotebookLMWorkspace.tsx"],
    catalogPrefixes: ["section.integrations", "integrations."],
    exclusions: [
      "Vault paths, cookies, and tokens are private values and are not indexed.",
      "Sync/test actions are consequential and are reached through their configuration groups.",
      "Public API/Webhooks and NotebookLM are omitted where the product/platform gate is unavailable.",
    ],
  },
  {
    section: SettingsTab.CloudStorage,
    sources: ["CloudStorageSettings.tsx", "SyncSettingsPanel.tsx", "BackupRestorePanel.tsx"],
    catalogPrefixes: ["section.cloud-storage", "cloudStorage."],
    exclusions: [
      "Cloud account/sync destinations are omitted when Plethora Cloud is unavailable.",
      "OAuth accounts, storage quota, and backup contents are private/runtime values.",
      "Connect/disconnect/restore buttons execute actions and are never invoked by search.",
    ],
  },
  {
    section: SettingsTab.ImportExport,
    sources: ["ImportExportSettings.tsx", "AppStateBackupDialog.tsx", "BackupRestorePanel.tsx"],
    catalogPrefixes: ["section.import-export", "importExport."],
    exclusions: [
      "Export, import, restore, and reset controls are background/data actions; search reveals their safe group entry point and never executes them.",
      "File paths and backup contents are private values.",
    ],
  },
  {
    section: SettingsTab.Notifications,
    sources: ["NotificationSettings.tsx"],
    catalogPrefixes: ["section.notifications", "notifications."],
    exclusions: [
      "Permission and capability status lines are informational, not configurable settings.",
      "Send-test executes a notification and is never invoked by search.",
    ],
  },
  {
    section: SettingsTab.Privacy,
    sources: ["SettingsPage.tsx", "PrivacyCenter.tsx", "DeleteAccountFlow.tsx"],
    catalogPrefixes: ["section.privacy", "privacy."],
    exclusions: [
      "Cloud export/deletion are consequential and only indexed as safe group entry points when Plethora Cloud is available.",
      "Stored account data and disclosure contents are not indexed as search terms beyond their labels.",
    ],
  },
  {
    section: SettingsTab.Handbook,
    sources: ["HandbookSettings.tsx", "handbookContent.ts"],
    catalogPrefixes: ["section.handbook", "handbook."],
    exclusions: ["Handbook chapter contents are reading documentation, not Settings controls; the handbook and its search are indexed."],
  },
  {
    section: SettingsTab.Help,
    sources: ["HelpSettings.tsx"],
    catalogPrefixes: ["section.help", "help."],
    exclusions: ["Replay/reset tour are safe group entry points; search never invokes them."],
  },
  {
    section: SettingsTab.Embeddings,
    sources: ["EmbeddingSettings.tsx", "AiIndexPanel.tsx"],
    catalogPrefixes: ["section.embeddings", "embeddings."],
    exclusions: [
      "Embedding API keys and indexed document contents are private values.",
      "Backfill/pause/reset index actions are consequential; search reveals the index group rather than executing them.",
    ],
  },
];
