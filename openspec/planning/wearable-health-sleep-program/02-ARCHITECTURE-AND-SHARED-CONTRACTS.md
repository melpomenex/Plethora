# Wearable Health & Learning Performance — Architecture & Shared Contracts

**Program:** `wearable-health-sleep-program`  
**Verification Date:** 2026-11-20

---

## 1. End-to-End Layered Data Flow

```text
┌───────────────────────────── Ingestion Sources ─────────────────────────────┐
│  iOS HealthKit       Android Health Connect     Cloud OAuth (Oura/WHOOP/    │
│  (Swift plugin)      (Kotlin plugin)            Google Health/Garmin)       │
│  Manual Sleep UI     CSV / JSON / Apple Health export.xml / .plethora-health│
└───────────────┬──────────────────┬──────────────────────┬───────────────────┘
                ▼                  ▼                      ▼
       NativeHealthAdapter   CloudHealthConnector    LocalImportService
                └──────────────────┴──────────────────────┘
                                   │
                                   ▼
                 Provider-Specific Parsers & Validators
           (timezone offsets, unit checks, stage mapping, bounds)
                                   │
                                   ▼
           Isolated Health Vault (<app_data_dir>/health/health.db)
        ┌──────────────────────────────────────────────────────────┐
        │ Raw Provenance Tables:                                   │
        │   health_raw_sleep_sessions, health_sleep_stage_intervals│
        │   health_physiological_observations, health_recovery_obs │
        │   health_connections, health_devices, health_consent_log │
        └──────────────────────────┬───────────────────────────────┘
                                   ▼
              Deterministic Deduplication & Reconciliation Engine
        ┌──────────────────────────────────────────────────────────┐
        │   health_canonical_sleep_episodes                        │
        │   health_sleep_episode_members (primary vs duplicate vs  │
        │     independent competing observations + conflict flags) │
        └──────────────────────────┬───────────────────────────────┘
                                   │
                ┌──────────────────┴──────────────────┐
                ▼                                     ▼
   Sleep & Circadian Analytics          Read-Only Learning Telemetry Loader
   (NAP classification, SRI proxy,      (<app_data_dir>/plethora.db — ZERO writes)
    circular timing, Borbély model)      - review_results + zero-leak FSRS-7 replay
                │                        - exam_attempts + exam_grades (final)
                │                        - study_plans + learning_evidence + reading
                └──────────────────┬──────────────────┘
                                   ▼
                 Learning-Health Correlation Engine (Rust)
        (time-aligned sessions, OLS confounder control, cluster bootstrap,
         BH-FDR, temporal held-out predictive validation, sufficiency gates)
                                   │
                                   ▼
                   Tauri IPC Commands (src-tauri/src/commands/health.rs)
                                   │
                                   ▼
          React 19 / Material 3 UI (Learning Insights, Sleep Chart,
            Settings → Integrations → Health & Wearables, Study Plans)
```

**Hard Isolation Boundary:** No arrow exists from `health.db` into `plethora.db`, `sync_outbox`, `BackupManager`, `semantic_chunks`, `MEMORY.md`, `llm_chat`, or `runTask`.

---

## 2. Connector Abstraction Families (Rust)

Native mobile platforms and OAuth cloud APIs have fundamentally different lifecycles and background constraints and therefore use separate Rust trait families producing shared normalized DTOs:

```rust
pub trait NativeHealthAdapter: Send + Sync {
    fn provider_id(&self) -> HealthProviderId;
    fn capabilities(&self) -> &'static [HealthDataCategory];
    fn check_availability(&self) -> NativeAvailability;
    fn normalize_sleep_payload(&self, raw: serde_json::Value) -> Result<NormalizedIngestionBatch, HealthProviderError>;
    fn normalize_physio_payload(&self, raw: serde_json::Value) -> Result<NormalizedIngestionBatch, HealthProviderError>;
}

#[async_trait::async_trait]
pub trait CloudHealthConnector: Send + Sync {
    fn provider_id(&self) -> HealthProviderId;
    fn catalog_entry(&self) -> ProviderCatalogEntry;
    fn readiness_state(&self, ctx: &ProviderConfigContext) -> ProviderReadinessState;
    fn build_authorize_url(&self, req: &OAuthStartContext) -> Result<String, HealthProviderError>;
    async fn sync_incremental(&self, access_token: &str, cursor: Option<&str>, start_ms: i64, end_ms: i64) -> Result<NormalizedIngestionBatch, HealthProviderError>;
}
```

---

## 3. Core Normalized Domain Models

- **`HealthProviderInfo`**: `id`, `category` (`native_mobile | cloud_oauth | local_manual | local_import | aggregator_bridged`), `displayName`, `supportedCategories`, `readinessState`, `readinessReason`, `implementationVersion`, `requiresApproval`, `requiresCredentials`, `supportsBackfill`, `maxBackfillDays`, `documentationUrl`.
- **`HealthConnection`**: `providerId`, `status`, `authState`, `grantedCategories`, `lastSyncAtMs`, `lastSuccessAtMs`, `syncCursor`, `accountSubjectHint` (never email/token), `lastErrorCode`, `lastErrorMessage`, `historyLimitDays`, `updatedAtMs`.
- **`HealthDevice`**: `id`, `providerId`, `externalDeviceId`, `manufacturer`, `model`, `sourceAppBundle`, `platformSourceId`, `metadataJson`.
- **`RawSleepSession`**: `id`, `providerId`, `deviceId`, `externalRecordId`, `sourceAppBundle`, `startAtMs`, `endAtMs`, `startTzOffsetSecs`, `endTzOffsetSecs`, `durationMins`, `timeInBedMins`, `sleepEfficiencyPct`, `sleepKind`, `providerSleepKind`, `qualityFlags`, `acquisitionAtMs`, `syncBatchId`, `isDeleted`, `isSynthetic`, `stages: Vec<SleepStageInterval>`.
- **`SleepStageInterval`**: `rawSessionId`, `stageType` (`awake | light | deep | rem | asleep_unknown | in_bed | unknown`), `startAtMs`, `endAtMs`, `providerStageCode`.
- **`CanonicalSleepEpisode`**: `id`, `primaryRawSessionId`, `primaryProviderId`, `startAtMs`, `endAtMs`, `anchorLocalDate`, `sleepKind` (`main_sleep | nap | unknown`), `userSleepKindOverride`, `totalSleepMins`, `timeInBedMins`, `sleepEfficiencyPct`, `wasoMins`, `stageCoverageRatio`, `awakeMins`, `lightMins`, `deepMins`, `remMins`, `hasSourceConflict`, `conflictDurationDiffMins`, `qualityFlags`, `isSynthetic`.
- **`SleepEpisodeMember`**: `canonicalEpisodeId`, `rawSessionId`, `providerId`, `relationship` (`primary | same_source_export_duplicate | independent_device_observation`), `priorityRank`.
- **`PhysiologicalObservation`**: `id`, `providerId`, `deviceId`, `externalRecordId`, `metricType` (`heart_rate | resting_heart_rate | hrv | spo2 | skin_temp_deviation | respiratory_rate | steps | active_calories`), `value`, `unit`, `hrvMethod` (`rmssd | sdnn | unknown`), `measuredAtMs`, `periodStartMs`, `periodEndMs`, `tzOffsetSecs`, `aggregationMethod`, `qualityFlags`, `isDeleted`, `isSynthetic`.
- **`RecoveryObservation`**: `id`, `providerId`, `externalRecordId`, `scoreName`, `scoreValue`, `scaleMin`, `scaleMax`, `scoreState`, `algorithmId`, `representedDate`, `measuredAtMs`, `underlyingMetricsJson`, `isSynthetic`.
- **`LearningHealthAssociation`**: derived read-model linking a review or study session (`sessionId`, `startedAtMs`, `endedAtMs`, `planIds`) to `precedingMainSleepEpisodeId`, `elapsedSinceAwakeningHours`, `recentNapMinutes`, `sleepRegularity7d`, `overnightHrv`, `overnightRhr`, `priorWorkload24h`, `meanItemDifficulty`, `meanFsrsResidual`, `medianLatencySeconds`, `analysisVersion`.

---

## 4. Time, Calendar & Biological Anchor Date Rules

1. **Instant Arithmetic:** Every duration (`end_at_ms - start_at_ms`) and elapsed-since-awakening calculation uses UTC millisecond epoch differences (`i64`), making calculations immune to DST 23-hour/25-hour wall-clock shifts and airline time-zone jumps.
2. **Biological Anchor Date (`anchor_local_date`):**
   - Apply the `end_tz_offset_secs` (wake timezone) to `end_at_ms` to obtain local wake datetime `local_wake`.
   - For **Main Sleep**: if local wake time is before `04:00` (rare split sleep ending early night), anchor to the prior evening's morning boundary (`local_wake.date()`); if sleep wakes up in the evening (`18:00–23:59`, shift worker waking before night work), anchor to `local_wake.date()`. Standard nocturnal sleep ending at `07:15` on Nov 20 anchors to `2026-11-20` regardless of whether bedtime was `22:30` Nov 19 or `01:15` Nov 20.
   - For **Naps**: anchor to the local calendar date of nap start (`start_at_ms + start_tz_offset_secs`).
3. **Timestamp Joins Over Calendar Joins:** Learning session attribution searches backward in `health_canonical_sleep_episodes` for the most recent completed main sleep whose `end_at_ms <= session_start_ms` and `(session_start_ms - end_at_ms) <= 36 hours` (and separately any nap ending within `[session_start_ms - 12h, session_start_ms]`). Learning at `01:30` before going to bed does **not** falsely attribute to that upcoming sleep!

---

## 5. Deduplication & Reconciliation Algorithm

1. Query all active (`is_deleted = 0`) `RawSleepSession` records overlapping `[window_start - 24h, window_end + 24h]`, ordered by `start_at_ms ASC`.
2. Partition into connected overlap components: two sessions belong to the same episode cluster if:
   - `intersection / union >= 0.50`, OR
   - `intersection / min(len_a, len_b) >= 0.65`, OR
   - `intersection > 0` and `|start_a - start_b| <= 15m && |end_a - end_b| <= 15m`.
3. Within each cluster, rank members deterministically using `HealthSourcePreference` (or default rank: `manual` override if user explicitly logged replacement, else direct wearable/cloud provider > OS health hub > file import, breaking ties by stage-data completeness, quality score, then provider ID).
4. Mark rank 0 as `primary`. For each remaining member `m`:
   - Classify `same_source_export_duplicate` if `m.source_app_bundle` matches primary's vendor bundle (e.g., `com.ouraring.oura` in Apple Health vs `oura` direct) OR (`|m.start_at_ms - p.start_at_ms| <= 120_000` and `|m.end_at_ms - p.end_at_ms| <= 120_000` and `m.device_id == p.device_id`).
   - Otherwise classify `independent_device_observation` and set `has_source_conflict = true` if `|m.duration_mins - p.duration_mins| > 30`.
5. Aggregate totals strictly over `health_canonical_sleep_episodes` (never summing raw sessions across duplicate members).

---

## 6. IPC Command Surface (`src-tauri/src/commands/health.rs`)

- Discovery & Sources: `health_list_providers`, `health_get_connections`, `health_get_source_preferences`, `health_set_source_preferences`, `health_get_privacy_settings`, `health_update_privacy_settings`, `health_get_consent_log`
- Native Sync Bridges: `health_sync_native_healthkit`, `health_sync_native_healthconnect`
- Cloud OAuth & Sync: `health_oauth_start`, `health_oauth_complete_callback`, `health_sync_provider`, `health_disconnect_provider`
- Manual & File I/O: `health_upsert_manual_sleep`, `health_delete_manual_sleep`, `health_override_sleep_kind`, `health_import_file`, `health_export_json`, `health_export_encrypted_bundle`, `health_import_encrypted_bundle`
- Demo Fixtures & Deletion: `health_load_demo_dataset`, `health_clear_demo_dataset`, `health_delete_provider_data`, `health_wipe_all_data`
- Analytics & Insights: `health_get_sleep_chart_data`, `health_get_learning_insights`, `health_get_study_plan_insights`
