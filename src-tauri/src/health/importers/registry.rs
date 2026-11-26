//! Deterministic registry of wearable import adapters and verified export guides.

use std::path::Path;

use crate::health::models::{HealthDataCategory, HealthProviderId};

use super::detector::ImportInspection;
use super::limits::{ArchiveSecurityLimits, StreamingParserLimits};
use super::types::{
    DetectionCandidate, ImportAdapterDescriptor, ImportCancellationToken, ImportError,
    ImportProgressEvent, ParsedImportOutput, ProviderExportGuide, VerificationStatus,
};

pub trait WearableImportAdapter: Send + Sync {
    fn descriptor(&self) -> ImportAdapterDescriptor;
    fn detect(&self, inspection: &ImportInspection) -> Option<DetectionCandidate>;
    fn parse_file(
        &self,
        path: &Path,
        archive_limits: &ArchiveSecurityLimits,
        streaming_limits: &StreamingParserLimits,
        cancel: &ImportCancellationToken,
        progress: Option<&dyn Fn(ImportProgressEvent)>,
        job_id: &str,
    ) -> Result<ParsedImportOutput, ImportError>;
}

pub fn build_provider_export_guides() -> Vec<ProviderExportGuide> {
    vec![
        ProviderExportGuide {
            provider_id: HealthProviderId::AppleHealthkit,
            display_name: "Apple Health / Apple Watch".to_string(),
            file_import_available: true,
            verification_status: VerificationStatus::ImplementedFixtureTested,
            supported_export_formats: vec!["Apple Health export.zip".to_string(), "export.xml".to_string()],
            export_steps: vec![
                "Open the Apple Health app on your iPhone.".to_string(),
                "Tap your profile picture in the top-right corner.".to_string(),
                "Scroll down and tap Export All Health Data.".to_string(),
                "Save or AirDrop the resulting export.zip (or extracted export.xml) and select it in Plethora.".to_string(),
            ],
            official_portal_url: "https://support.apple.com/guide/iphone/share-your-health-data-iph5ede58c3d/ios".to_string(),
            available_categories: vec![
                HealthDataCategory::Sleep,
                HealthDataCategory::SleepStages,
                HealthDataCategory::HeartRate,
                HealthDataCategory::RestingHeartRate,
                HealthDataCategory::Hrv,
                HealthDataCategory::RespiratoryRate,
                HealthDataCategory::Activity,
            ],
            limitations: vec![
                "Apple Health HRV uses SDNN rather than RMSSD; Plethora keeps them separate.".to_string(),
                "Apple Health does not export proprietary sleep or readiness scores.".to_string(),
            ],
            native_bridge_available: true,
            cloud_sync_requires_approval: false,
            readiness_label: "Native export import available".to_string(),
            last_verified_date: "2026-11-26".to_string(),
        },
        ProviderExportGuide {
            provider_id: HealthProviderId::Garmin,
            display_name: "Garmin".to_string(),
            file_import_available: true,
            verification_status: VerificationStatus::ImplementedFixtureTested,
            supported_export_formats: vec![
                "Garmin Account Data Management ZIP (DI_CONNECT/DI-Connect-Wellness/*_sleepData.json)".to_string(),
                "Standalone *_sleepData.json".to_string(),
            ],
            export_steps: vec![
                "Sign in to Garmin Account Management (Data Management -> Export Your Data).".to_string(),
                "Click Request Data Export and download the ZIP archive from the email link.".to_string(),
                "Select the downloaded .zip archive directly in Plethora without extracting it.".to_string(),
            ],
            official_portal_url: "https://www.garmin.com/en-US/account/datamanagement/exportdata".to_string(),
            available_categories: vec![
                HealthDataCategory::Sleep,
                HealthDataCategory::SleepStages,
                HealthDataCategory::RespiratoryRate,
                HealthDataCategory::Recovery,
            ],
            limitations: vec![
                "Workout .fit files do not contain sleep records; use Garmin's full account data export.".to_string(),
                "Direct Garmin Health API cloud sync requires commercial developer approval, but local archive import works immediately.".to_string(),
            ],
            native_bridge_available: true,
            cloud_sync_requires_approval: true,
            readiness_label: "Native export import available".to_string(),
            last_verified_date: "2026-11-26".to_string(),
        },
        ProviderExportGuide {
            provider_id: HealthProviderId::Oura,
            display_name: "Oura Ring".to_string(),
            file_import_available: true,
            verification_status: VerificationStatus::ImplementedFixtureTested,
            supported_export_formats: vec![
                "Oura on the Web ZIP / CSV (sleep.csv, daily_sleep.csv, daily_readiness.csv)".to_string(),
                "Oura JSON sleep export".to_string(),
            ],
            export_steps: vec![
                "Sign in to Oura on the Web (cloud.ouraring.com) -> My Account -> Export Data.".to_string(),
                "Download your personal data archive (.zip) or sleep.csv.".to_string(),
                "Select the .zip or .csv file in Plethora.".to_string(),
            ],
            official_portal_url: "https://cloud.ouraring.com/".to_string(),
            available_categories: vec![
                HealthDataCategory::Sleep,
                HealthDataCategory::SleepStages,
                HealthDataCategory::HeartRate,
                HealthDataCategory::RestingHeartRate,
                HealthDataCategory::Hrv,
                HealthDataCategory::Temperature,
                HealthDataCategory::RespiratoryRate,
                HealthDataCategory::Recovery,
            ],
            limitations: vec![
                "5-minute hypnogram stages (sleep_phase_5_min) are decoded when present in sleep.csv or JSON.".to_string(),
            ],
            native_bridge_available: true,
            cloud_sync_requires_approval: false,
            readiness_label: "Native export import available".to_string(),
            last_verified_date: "2026-11-26".to_string(),
        },
        ProviderExportGuide {
            provider_id: HealthProviderId::Whoop,
            display_name: "WHOOP".to_string(),
            file_import_available: true,
            verification_status: VerificationStatus::ImplementedFixtureTested,
            supported_export_formats: vec![
                "WHOOP Data Export ZIP (sleeps.csv + physiological_cycles.csv)".to_string(),
                "Standalone sleeps.csv / physiological_cycles.csv".to_string(),
            ],
            export_steps: vec![
                "Open the WHOOP app -> More -> App Settings -> Data Export.".to_string(),
                "Request your export and download the .zip file sent to your email.".to_string(),
                "Select the .zip archive directly in Plethora.".to_string(),
            ],
            official_portal_url: "https://support.whoop.com/s/article/WHOOP-Data-Export".to_string(),
            available_categories: vec![
                HealthDataCategory::Sleep,
                HealthDataCategory::RestingHeartRate,
                HealthDataCategory::Hrv,
                HealthDataCategory::Recovery,
                HealthDataCategory::Temperature,
                HealthDataCategory::RespiratoryRate,
            ],
            limitations: vec![
                "WHOOP exports provide aggregate stage durations (Light, SWS, REM, Awake) rather than per-epoch hypnogram timestamps; Plethora displays totals without fabricating timeline intervals.".to_string(),
            ],
            native_bridge_available: true,
            cloud_sync_requires_approval: false,
            readiness_label: "Native export import available".to_string(),
            last_verified_date: "2026-11-26".to_string(),
        },
        ProviderExportGuide {
            provider_id: HealthProviderId::GoogleHealth,
            display_name: "Google Health / Fitbit".to_string(),
            file_import_available: true,
            verification_status: VerificationStatus::ImplementedFixtureTested,
            supported_export_formats: vec![
                "Google Takeout Fitbit ZIP (Takeout/Fitbit/Global Export Data/sleep-*.json)".to_string(),
                "Standalone Fitbit sleep-*.json or sleep CSV".to_string(),
            ],
            export_steps: vec![
                "Go to takeout.google.com and select Fitbit (or Google Fit / Health data).".to_string(),
                "Download the generated .zip archive.".to_string(),
                "Select the Takeout .zip archive in Plethora; unrelated Takeout folders are skipped automatically.".to_string(),
            ],
            official_portal_url: "https://takeout.google.com/".to_string(),
            available_categories: vec![
                HealthDataCategory::Sleep,
                HealthDataCategory::SleepStages,
                HealthDataCategory::RestingHeartRate,
                HealthDataCategory::Hrv,
                HealthDataCategory::Recovery,
            ],
            limitations: vec![
                "Legacy Fitbit Web API was retired in 2026; local Takeout archive import works for all historical Fitbit exports without API credentials.".to_string(),
            ],
            native_bridge_available: true,
            cloud_sync_requires_approval: true,
            readiness_label: "Native export import available".to_string(),
            last_verified_date: "2026-11-26".to_string(),
        },
        ProviderExportGuide {
            provider_id: HealthProviderId::SamsungHealth,
            display_name: "Samsung Health (Galaxy Watch / Ring)".to_string(),
            file_import_available: true,
            verification_status: VerificationStatus::ImplementedFixtureTested,
            supported_export_formats: vec![
                "Samsung Health Personal Data ZIP (com.samsung.health.sleep*.csv + sleep_stage*.csv)".to_string(),
            ],
            export_steps: vec![
                "Open Samsung Health -> Menu -> Settings -> Download personal data.".to_string(),
                "Zip or select the exported Samsung Health folder/archive and import it into Plethora.".to_string(),
            ],
            official_portal_url: "https://www.samsung.com/us/support/answer/ANS00083496/".to_string(),
            available_categories: vec![
                HealthDataCategory::Sleep,
                HealthDataCategory::SleepStages,
                HealthDataCategory::HeartRate,
                HealthDataCategory::Recovery,
            ],
            limitations: vec![
                "Also syncs directly to Android Health Connect on Android devices.".to_string(),
            ],
            native_bridge_available: true,
            cloud_sync_requires_approval: true,
            readiness_label: "Native export import available".to_string(),
            last_verified_date: "2026-11-26".to_string(),
        },
        ProviderExportGuide {
            provider_id: HealthProviderId::Withings,
            display_name: "Withings".to_string(),
            file_import_available: true,
            verification_status: VerificationStatus::ImplementedFixtureTested,
            supported_export_formats: vec![
                "Withings Health Data Export ZIP / sleep.csv".to_string(),
            ],
            export_steps: vec![
                "Open the Withings app or web dashboard -> Profile -> Settings -> Export All Health Data.".to_string(),
                "Download the .zip archive and select it in Plethora.".to_string(),
            ],
            official_portal_url: "https://support.withings.com/hc/en-us/articles/201491377".to_string(),
            available_categories: vec![
                HealthDataCategory::Sleep,
                HealthDataCategory::HeartRate,
            ],
            limitations: vec![
                "Withings sleep.csv provides aggregate stage durations rather than per-epoch hypnogram intervals.".to_string(),
            ],
            native_bridge_available: true,
            cloud_sync_requires_approval: true,
            readiness_label: "Native export import available".to_string(),
            last_verified_date: "2026-11-26".to_string(),
        },
        ProviderExportGuide {
            provider_id: HealthProviderId::Ringconn,
            display_name: "RingConn".to_string(),
            file_import_available: true,
            verification_status: VerificationStatus::ImplementedFixtureTested,
            supported_export_formats: vec![
                "RingConn Data Export ZIP (sleep.csv + vitals.csv)".to_string(),
            ],
            export_steps: vec![
                "Open the RingConn app -> Me -> App Settings -> Data Management -> Data Export.".to_string(),
                "Select your date range, enter your email, and import the resulting .zip into Plethora.".to_string(),
            ],
            official_portal_url: "https://ringconn.com/".to_string(),
            available_categories: vec![
                HealthDataCategory::Sleep,
                HealthDataCategory::HeartRate,
                HealthDataCategory::RestingHeartRate,
                HealthDataCategory::Hrv,
                HealthDataCategory::Recovery,
            ],
            limitations: vec![
                "If RingConn sleep.csv provides daily date-keyed totals without exact bedtime/wake timestamps, stage totals are preserved as aggregate summaries.".to_string(),
            ],
            native_bridge_available: true,
            cloud_sync_requires_approval: false,
            readiness_label: "Native export import available".to_string(),
            last_verified_date: "2026-11-26".to_string(),
        },
        ProviderExportGuide {
            provider_id: HealthProviderId::Polar,
            display_name: "Polar".to_string(),
            file_import_available: true,
            verification_status: VerificationStatus::PartialRecoveryOnly,
            supported_export_formats: vec![
                "Polar Account Export ZIP (nightly_recovery_*.json for HRV/ANS recovery)".to_string(),
            ],
            export_steps: vec![
                "Sign in at account.polar.com -> Download your data to import Nightly Recharge HRV/recovery JSON.".to_string(),
                "For full sleep timing and stages, enable Polar Flow sync to Apple Health (iOS) or Android Health Connect.".to_string(),
            ],
            official_portal_url: "https://account.polar.com/".to_string(),
            available_categories: vec![
                HealthDataCategory::Hrv,
                HealthDataCategory::Recovery,
                HealthDataCategory::RespiratoryRate,
            ],
            limitations: vec![
                "Polar's account export officially excludes sleep session timelines; use Apple Health or Health Connect bridge for sleep durations and stages.".to_string(),
            ],
            native_bridge_available: true,
            cloud_sync_requires_approval: false,
            readiness_label: "Partial recovery export; sleep via Apple Health / Health Connect".to_string(),
            last_verified_date: "2026-11-26".to_string(),
        },
        ProviderExportGuide {
            provider_id: HealthProviderId::Suunto,
            display_name: "Suunto".to_string(),
            file_import_available: false,
            verification_status: VerificationStatus::BridgeRequired,
            supported_export_formats: vec![
                "Apple Health / Health Connect bridge (workout .fit/.gpx files lack sleep)".to_string(),
            ],
            export_steps: vec![
                "Suunto's app exports workouts (.fit/.gpx) without sleep records.".to_string(),
                "Sync Suunto to Apple Health (iOS) or Health Connect (Android), then sync or export Apple Health into Plethora.".to_string(),
            ],
            official_portal_url: "https://www.suunto.com/Support/".to_string(),
            available_categories: vec![],
            limitations: vec![
                "Native consumer sleep export is unavailable; workout-only FIT/GPX exports do not contain sleep.".to_string(),
            ],
            native_bridge_available: true,
            cloud_sync_requires_approval: true,
            readiness_label: "Supported through Apple Health / Health Connect".to_string(),
            last_verified_date: "2026-11-26".to_string(),
        },
        ProviderExportGuide {
            provider_id: HealthProviderId::Ultrahuman,
            display_name: "Ultrahuman Ring".to_string(),
            file_import_available: false,
            verification_status: VerificationStatus::BridgeRequired,
            supported_export_formats: vec![
                "Apple Health / Health Connect bridge, or Generic CSV Mapping Wizard".to_string(),
            ],
            export_steps: vec![
                "Ultrahuman does not currently provide a self-serve in-app sleep CSV/JSON export button.".to_string(),
                "Connect Ultrahuman to Apple Health or Android Health Connect, or import a third-party CSV using Plethora's CSV Mapping Wizard.".to_string(),
            ],
            official_portal_url: "https://www.ultrahuman.com/".to_string(),
            available_categories: vec![],
            limitations: vec![
                "No verified self-serve consumer sleep export format; use mobile health bridge or CSV mapping.".to_string(),
            ],
            native_bridge_available: true,
            cloud_sync_requires_approval: true,
            readiness_label: "Supported through Apple Health / Health Connect".to_string(),
            last_verified_date: "2026-11-26".to_string(),
        },
        ProviderExportGuide {
            provider_id: HealthProviderId::AndroidHealthConnect,
            display_name: "Android Health Connect".to_string(),
            file_import_available: false,
            verification_status: VerificationStatus::UnsupportedInternalFormat,
            supported_export_formats: vec![
                "Native Android Health Connect sync or .plethora-health.enc portable bundle".to_string(),
            ],
            export_steps: vec![
                "On Android, connect Android Health Connect directly in Plethora's Data Sources.".to_string(),
                "To move records to desktop, export an encrypted .plethora-health.enc bundle from Plethora on Android and import it on desktop.".to_string(),
            ],
            official_portal_url: "https://developer.android.com/health-and-fitness/guides/health-connect".to_string(),
            available_categories: vec![
                HealthDataCategory::Sleep,
                HealthDataCategory::SleepStages,
                HealthDataCategory::HeartRate,
                HealthDataCategory::RestingHeartRate,
                HealthDataCategory::Hrv,
            ],
            limitations: vec![
                "Health Connect system backups (.zip) contain an internal Android SQLite database whose schema is not a stable portable interchange format.".to_string(),
            ],
            native_bridge_available: true,
            cloud_sync_requires_approval: false,
            readiness_label: "Native Android sync + .plethora-health.enc transfer".to_string(),
            last_verified_date: "2026-11-26".to_string(),
        },
    ]
}
