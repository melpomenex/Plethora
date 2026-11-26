import { invokeCommand, isTauri } from "../lib/tauri";
import type {
  CsvMappingProfile,
  HealthAnalysisRange,
  HealthConnection,
  HealthDataCategory,
  HealthConsentRecord,
  HealthFileImportResult,
  HealthImportFormat,
  HealthPrivacySettings,
  HealthProviderId,
  HealthProviderInfo,
  HealthSourcePreference,
  HealthSyncReport,
  ImportAdapterDescriptor,
  ImportBatchSummary,
  ImportCommitResult,
  ImportPreview,
  LearningInsightsReport,
  ManualSleepInput,
  ProviderExportGuide,
  SleepChartData,
  SleepKind,
  WatchedImportFolder,
  WatchedScanReport,
} from "../types/health";

function invokeHealth<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    return Promise.reject(new Error("The local health vault is only available in the native app."));
  }
  return invokeCommand<T>(command, args);
}

export const healthApi = {
  listProviders: () =>
    invokeHealth<HealthProviderInfo[]>("health_list_providers"),
  connectCloud: (providerId: HealthProviderId) =>
    invokeHealth<void>("health_connect_cloud", { providerId }),
  connectNative: (providerId: HealthProviderId, categories: HealthDataCategory[], includeHistory: boolean) =>
    invokeHealth<HealthSyncReport>("health_connect_native", { providerId, consent: { categories, includeHistory } }),
  syncProvider: (providerId: HealthProviderId, native: boolean) =>
    invokeHealth<HealthSyncReport>(native ? "health_sync_native" : "health_sync_cloud", { providerId }),
  disconnectProvider: (providerId: HealthProviderId) =>
    invokeHealth<void>("health_disconnect_provider", { providerId }),
  getConnections: () =>
    invokeHealth<HealthConnection[]>("health_get_connections"),
  getSourcePreferences: () =>
    invokeHealth<HealthSourcePreference[]>("health_get_source_preferences"),
  setSourcePreferences: (preference: HealthSourcePreference) =>
    invokeHealth<void>("health_set_source_preferences", { preference }),
  getPrivacySettings: () =>
    invokeHealth<HealthPrivacySettings>("health_get_privacy_settings"),
  updatePrivacySettings: (settings: HealthPrivacySettings) =>
    invokeHealth<HealthPrivacySettings>("health_update_privacy_settings", { settings }),
  getConsentLog: () =>
    invokeHealth<HealthConsentRecord[]>("health_get_consent_log"),
  getManualSleep: (rawSessionId: string) =>
    invokeHealth<{ notes: string | null; subjectiveQuality: number | null }>("health_get_manual_sleep", { rawSessionId }),
  upsertManualSleep: (input: ManualSleepInput) =>
    invokeHealth<HealthSyncReport>("health_upsert_manual_sleep", { input }),
  deleteManualSleep: (rawSessionId: string) =>
    invokeHealth<boolean>("health_delete_manual_sleep", { rawSessionId }),
  overrideSleepKind: (rawSessionId: string, sleepKind: SleepKind) =>
    invokeHealth<void>("health_override_sleep_kind", { rawSessionId, sleepKind }),
  importFile: (format: HealthImportFormat) =>
    invokeHealth<HealthFileImportResult | null>("health_import_file", { format }),
  exportJson: () =>
    invokeHealth<boolean>("health_export_json"),
  importEncryptedBundle: (passphrase: string) =>
    invokeHealth<HealthFileImportResult | null>("health_import_encrypted_bundle", { passphrase }),
  exportEncryptedBundle: (passphrase: string) =>
    invokeHealth<boolean>("health_export_encrypted_bundle", { passphrase }),
  loadDemo: () =>
    invokeHealth<void>("health_load_demo_dataset"),
  clearDemo: () =>
    invokeHealth<void>("health_clear_demo_dataset"),
  deleteProviderData: (providerId: HealthProviderId) =>
    invokeHealth<void>("health_delete_provider_data", { providerId }),
  wipeAllData: () =>
    invokeHealth<void>("health_wipe_all_data"),
  getSleepChart: (range: HealthAnalysisRange, demo: boolean, includeLearning: boolean) =>
    invokeHealth<SleepChartData>("health_get_sleep_chart_data", { range, demo, includeLearning }),
  getLearningInsights: (range: HealthAnalysisRange, demo: boolean) =>
    invokeHealth<LearningInsightsReport>("health_get_learning_insights", { range, demo }),
  getStudyPlanInsights: (range: HealthAnalysisRange, planId: string) =>
    invokeHealth<LearningInsightsReport>("health_get_study_plan_insights", { range, planId }),
  listImportAdapters: () =>
    invokeHealth<ImportAdapterDescriptor[]>("health_list_import_adapters"),
  getProviderExportGuides: () =>
    invokeHealth<ProviderExportGuide[]>("health_get_provider_export_guides"),
  pickWearableImportFiles: () =>
    invokeHealth<string[]>("health_pick_wearable_import_files"),
  previewWearableImport: (
    filePath: string,
    overrideAdapterId?: string | null,
    mappingProfile?: CsvMappingProfile | null,
  ) =>
    invokeHealth<ImportPreview>("health_preview_wearable_import", {
      filePath,
      overrideAdapterId: overrideAdapterId ?? null,
      mappingProfile: mappingProfile ?? null,
    }),
  commitWearableImport: (params: {
    jobId: string;
    filePath: string;
    adapterId?: string | null;
    providerOverride?: HealthProviderId | null;
    selectedCategories: HealthDataCategory[];
    mappingProfile?: CsvMappingProfile | null;
  }) =>
    invokeHealth<ImportCommitResult>("health_commit_wearable_import", {
      jobId: params.jobId,
      filePath: params.filePath,
      adapterId: params.adapterId ?? null,
      providerOverride: params.providerOverride ?? null,
      selectedCategories: params.selectedCategories,
      mappingProfile: params.mappingProfile ?? null,
    }),
  cancelWearableImport: (jobId: string) =>
    invokeHealth<boolean>("health_cancel_wearable_import", { jobId }),
  listImportBatches: (limit?: number) =>
    invokeHealth<ImportBatchSummary[]>("health_list_import_batches", { limit: limit ?? 50 }),
  deleteImportBatch: (batchId: string) =>
    invokeHealth<boolean>("health_delete_import_batch", { batchId }),
  saveCsvMappingProfile: (profile: CsvMappingProfile) =>
    invokeHealth<CsvMappingProfile>("health_save_csv_mapping_profile", { profile }),
  listCsvMappingProfiles: () =>
    invokeHealth<CsvMappingProfile[]>("health_list_csv_mapping_profiles"),
  deleteCsvMappingProfile: (id: string) =>
    invokeHealth<void>("health_delete_csv_mapping_profile", { id }),
  pickWatchedFolder: () =>
    invokeHealth<string | null>("health_pick_watched_folder"),
  addWatchedFolder: (folderPath: string, autoCommit: boolean) =>
    invokeHealth<WatchedImportFolder>("health_add_watched_folder", { folderPath, autoCommit }),
  listWatchedFolders: () =>
    invokeHealth<WatchedImportFolder[]>("health_list_watched_folders"),
  removeWatchedFolder: (folderId: string) =>
    invokeHealth<void>("health_remove_watched_folder", { folderId }),
  scanWatchedFolders: () =>
    invokeHealth<WatchedScanReport>("health_scan_watched_folders"),
};
