//! Authoritative Wearable & Health Provider Capability Catalog and honest readiness gating.

use std::collections::HashMap;

use crate::health::models::{
    HealthConnection, HealthDataCategory, HealthProviderId, HealthProviderInfo, ProviderCategory,
    ProviderReadinessState,
};
use crate::health::provider::ProviderConfigContext;

pub fn build_provider_catalog(
    ctx: &ProviderConfigContext,
    connections: &[HealthConnection],
) -> Vec<HealthProviderInfo> {
    let conn_map: HashMap<HealthProviderId, &HealthConnection> =
        connections.iter().map(|c| (c.provider_id, c)).collect();

    let mut items = vec![
        // ── Local Zero-Wearable Routes ──────────────────────────
        HealthProviderInfo {
            id: HealthProviderId::Manual,
            category: ProviderCategory::LocalManual,
            display_name: HealthProviderId::Manual.display_name().to_string(),
            supported_categories: vec![HealthDataCategory::Sleep],
            readiness_state: ProviderReadinessState::Available,
            readiness_reason: "Always available offline without a wearable device".to_string(),
            implementation_version: "1.0.0".to_string(),
            requires_approval: false,
            requires_credentials: false,
            supports_backfill: true,
            max_backfill_days: None,
            bridged_via: vec![],
            documentation_url: "docs/product/features/platform/wearable-health-insights.md".to_string(),
            limitations: vec!["Manual entries do not synthesize sleep stage intervals".to_string()],
        },
        HealthProviderInfo {
            id: HealthProviderId::FileImport,
            category: ProviderCategory::LocalImport,
            display_name: HealthProviderId::FileImport.display_name().to_string(),
            supported_categories: vec![
                HealthDataCategory::Sleep,
                HealthDataCategory::SleepStages,
                HealthDataCategory::HeartRate,
                HealthDataCategory::RestingHeartRate,
                HealthDataCategory::Hrv,
                HealthDataCategory::Activity,
            ],
            readiness_state: ProviderReadinessState::Available,
            readiness_reason: "Supports Plethora JSON, CSV, Apple Health export.xml, and encrypted .plethora-health.enc".to_string(),
            implementation_version: "1.0.0".to_string(),
            requires_approval: false,
            requires_credentials: false,
            supports_backfill: true,
            max_backfill_days: None,
            bridged_via: vec![],
            documentation_url: "docs/product/features/platform/wearable-health-insights.md".to_string(),
            limitations: vec!["Apple Health XML imports are subject to a 50 MB parser safeguard".to_string()],
        },
        // ── Native Mobile Bridges ───────────────────────────────
        native_healthkit_info(ctx, conn_map.get(&HealthProviderId::AppleHealthkit).copied()),
        native_healthconnect_info(
            ctx,
            conn_map
                .get(&HealthProviderId::AndroidHealthConnect)
                .copied(),
        ),
        // ── Tier 1 Direct Cloud APIs ────────────────────────────
        cloud_provider_info(
            HealthProviderId::Oura,
            "https://cloud.ouraring.com/v2/docs",
            vec![
                HealthDataCategory::Sleep,
                HealthDataCategory::SleepStages,
                HealthDataCategory::HeartRate,
                HealthDataCategory::RestingHeartRate,
                HealthDataCategory::Hrv,
                HealthDataCategory::Recovery,
                HealthDataCategory::Temperature,
            ],
            false,
            Some(1825),
            vec![
                "Gen 3 / Ring 4 users require an active Oura Membership for API access".to_string(),
                "Newly registered Oura developer apps are capped at 10 users until reviewed".to_string(),
            ],
            ctx,
            conn_map.get(&HealthProviderId::Oura).copied(),
        ),
        cloud_provider_info(
            HealthProviderId::Whoop,
            "https://developer.whoop.com/api/",
            vec![
                HealthDataCategory::Sleep,
                HealthDataCategory::HeartRate,
                HealthDataCategory::RestingHeartRate,
                HealthDataCategory::Hrv,
                HealthDataCategory::Recovery,
                HealthDataCategory::RespiratoryRate,
            ],
            false,
            Some(1095),
            vec![
                "WHOOP v2 exposes stage totals (duration) without per-5-minute hypnogram timestamps".to_string(),
                "Rate limits default to 100 requests/min and 10,000 requests/day; sandbox capped at 10 members".to_string(),
            ],
            ctx,
            conn_map.get(&HealthProviderId::Whoop).copied(),
        ),
        cloud_provider_info(
            HealthProviderId::GoogleHealth,
            "https://developers.google.com/health",
            vec![
                HealthDataCategory::Sleep,
                HealthDataCategory::SleepStages,
                HealthDataCategory::HeartRate,
                HealthDataCategory::RestingHeartRate,
                HealthDataCategory::Hrv,
            ],
            true,
            Some(730),
            vec![
                "Legacy Fitbit Web API was retired in 2026; uses Google Health API v4 only".to_string(),
                "Restricted health scopes require Google OAuth verification and annual CASA assessment beyond 100 test users".to_string(),
            ],
            ctx,
            conn_map.get(&HealthProviderId::GoogleHealth).copied(),
        ),
        cloud_provider_info(
            HealthProviderId::Garmin,
            "https://developer.garmin.com/gc-developer-program/health-api/",
            vec![
                HealthDataCategory::Sleep,
                HealthDataCategory::Recovery,
            ],
            true,
            Some(30),
            vec![
                "Requires commercial Garmin Connect Developer Program approval (Personal API is forbidden for commercial apps)".to_string(),
                "Starter tier has no historical backfill; Enterprise tier provides >= 1 month backfill".to_string(),
            ],
            ctx,
            conn_map.get(&HealthProviderId::Garmin).copied(),
        ),
        // ── Tier 2 Ecosystem & Aggregator-Bridged Devices ───────
        tier2_bridged_info(
            HealthProviderId::Polar,
            "https://www.polar.com/accesslink-api/",
            vec![HealthDataCategory::Sleep, HealthDataCategory::SleepStages, HealthDataCategory::Hrv, HealthDataCategory::Recovery],
            "Polar AccessLink v3/v4 direct sync is deferred; connect via Apple Health or Android Health Connect.",
        ),
        tier2_bridged_info(
            HealthProviderId::Withings,
            "https://developer.withings.com/api-reference/",
            vec![HealthDataCategory::Sleep, HealthDataCategory::SleepStages, HealthDataCategory::HeartRate],
            "Withings HRV endpoints require enterprise API tier; connect ScanWatch/Sleep Analyzer via Apple Health or Health Connect.",
        ),
        tier2_bridged_info(
            HealthProviderId::SamsungHealth,
            "https://developer.samsung.com/health",
            vec![HealthDataCategory::Sleep, HealthDataCategory::SleepStages, HealthDataCategory::HeartRate, HealthDataCategory::Hrv],
            "Samsung Health Partner SDK requires developer review; Galaxy Watch & Ring write directly to Android Health Connect.",
        ),
        tier2_bridged_info(
            HealthProviderId::Suunto,
            "https://apizone.suunto.com/",
            vec![HealthDataCategory::Sleep, HealthDataCategory::SleepStages, HealthDataCategory::Hrv, HealthDataCategory::Recovery],
            "Suunto 24/7 API is restricted to approved commercial partners; sync via Apple Health or Android Health Connect.",
        ),
        tier2_bridged_info(
            HealthProviderId::Ultrahuman,
            "https://developer.ultrahuman.com/",
            vec![HealthDataCategory::Sleep, HealthDataCategory::SleepStages, HealthDataCategory::Hrv, HealthDataCategory::Recovery],
            "Ultrahuman UltraSignal requires partner approval; bridge ring data through Apple Health or Android Health Connect.",
        ),
        HealthProviderInfo {
            id: HealthProviderId::Ringconn,
            category: ProviderCategory::AggregatorBridged,
            display_name: HealthProviderId::Ringconn.display_name().to_string(),
            supported_categories: vec![HealthDataCategory::Sleep, HealthDataCategory::HeartRate, HealthDataCategory::Hrv],
            readiness_state: ProviderReadinessState::Unsupported,
            readiness_reason: "RingConn provides no official public third-party REST API; connect RingConn via Apple Health or Android Health Connect.".to_string(),
            implementation_version: "1.0.0".to_string(),
            requires_approval: false,
            requires_credentials: false,
            supports_backfill: false,
            max_backfill_days: None,
            bridged_via: vec![HealthProviderId::AppleHealthkit, HealthProviderId::AndroidHealthConnect],
            documentation_url: "https://ringconn.com/".to_string(),
            limitations: vec!["No public developer OAuth API; relies on mobile health aggregator export".to_string()],
        },
    ];

    // Preserve deterministic order
    items.sort_by_key(|p| p.id.default_priority_rank());
    items
}

fn native_healthkit_info(
    ctx: &ProviderConfigContext,
    conn: Option<&HealthConnection>,
) -> HealthProviderInfo {
    let (readiness_state, readiness_reason) = if ctx.platform_os != "ios" {
        (
            ProviderReadinessState::Unsupported,
            "Apple HealthKit is only available on iOS; desktop users can import Apple Health export.xml or encrypted transfer bundles.".to_string(),
        )
    } else if !ctx.healthkit_entitlement_enabled {
        (
            ProviderReadinessState::FeatureDisabledCompliance,
            "HealthKit entitlement is compliance-gated pending Apple Developer provisioning & App Store Guideline 5.1.3 review.".to_string(),
        )
    } else if let Some(c) = conn {
        (c.status, "Connected to iOS Apple HealthKit".to_string())
    } else {
        (
            ProviderReadinessState::RequiresUserAuthorization,
            "Ready to request granular Apple Health read permissions on iOS".to_string(),
        )
    };

    HealthProviderInfo {
        id: HealthProviderId::AppleHealthkit,
        category: ProviderCategory::NativeMobile,
        display_name: HealthProviderId::AppleHealthkit.display_name().to_string(),
        supported_categories: vec![
            HealthDataCategory::Sleep,
            HealthDataCategory::SleepStages,
            HealthDataCategory::HeartRate,
            HealthDataCategory::RestingHeartRate,
            HealthDataCategory::Hrv,
            HealthDataCategory::Activity,
        ],
        readiness_state,
        readiness_reason,
        implementation_version: "1.0.0".to_string(),
        requires_approval: true,
        requires_credentials: false,
        supports_backfill: true,
        max_backfill_days: None,
        bridged_via: vec![],
        documentation_url: "https://developer.apple.com/documentation/healthkit".to_string(),
        limitations: vec![
            "Apple Health HRV uses SDNN rather than RMSSD".to_string(),
            "HealthKit data is strictly excluded from iCloud backup & Plethora Cloud sync (Guideline 5.1.3)".to_string(),
            "Apple Health read denial appears identically to empty data to preserve privacy".to_string(),
        ],
    }
}

fn native_healthconnect_info(
    ctx: &ProviderConfigContext,
    conn: Option<&HealthConnection>,
) -> HealthProviderInfo {
    let (readiness_state, readiness_reason) = if ctx.platform_os != "android" {
        (
            ProviderReadinessState::Unsupported,
            "Android Health Connect is only available on Android devices; desktop users can import JSON/CSV or encrypted transfer bundles.".to_string(),
        )
    } else if let Some(c) = conn {
        (c.status, "Connected to Android Health Connect".to_string())
    } else {
        (
            ProviderReadinessState::RequiresUserAuthorization,
            "Ready to request granular Health Connect permissions on Android".to_string(),
        )
    };

    HealthProviderInfo {
        id: HealthProviderId::AndroidHealthConnect,
        category: ProviderCategory::NativeMobile,
        display_name: HealthProviderId::AndroidHealthConnect
            .display_name()
            .to_string(),
        supported_categories: vec![
            HealthDataCategory::Sleep,
            HealthDataCategory::SleepStages,
            HealthDataCategory::HeartRate,
            HealthDataCategory::RestingHeartRate,
            HealthDataCategory::Hrv,
            HealthDataCategory::Activity,
        ],
        readiness_state,
        readiness_reason,
        implementation_version: "1.0.0".to_string(),
        requires_approval: true,
        requires_credentials: false,
        supports_backfill: true,
        max_backfill_days: None,
        bridged_via: vec![],
        documentation_url: "https://developer.android.com/health-and-fitness/guides/health-connect"
            .to_string(),
        limitations: vec![
            "Default Health Connect window is 30 days unless READ_HEALTH_DATA_HISTORY is granted"
                .to_string(),
            "Background reads require explicit READ_HEALTH_DATA_IN_BACKGROUND permission"
                .to_string(),
        ],
    }
}

#[allow(clippy::too_many_arguments)]
fn cloud_provider_info(
    id: HealthProviderId,
    doc_url: &str,
    supported_categories: Vec<HealthDataCategory>,
    requires_approval: bool,
    max_backfill_days: Option<u32>,
    limitations: Vec<String>,
    ctx: &ProviderConfigContext,
    conn: Option<&HealthConnection>,
) -> HealthProviderInfo {
    let id_str = id.as_str();
    let broker_configured = ctx.oauth_broker_url.is_some()
        && ctx.broker_configured_providers.iter().any(|p| p == id_str);
    let approved = !requires_approval || ctx.broker_approved_providers.iter().any(|p| p == id_str);

    let (readiness_state, readiness_reason) = if let Some(c) = conn {
        (
            c.status,
            format!("{} connection active ({:?})", id.display_name(), c.status),
        )
    } else if requires_approval && !approved {
        (
            ProviderReadinessState::RequiresDeveloperApproval,
            format!(
                "{} requires approved commercial/verified developer credentials before connecting; use Apple Health or Android Health Connect meanwhile.",
                id.display_name()
            ),
        )
    } else if !broker_configured {
        (
            ProviderReadinessState::NotConfigured,
            format!(
                "OAuth broker credentials for {} are not configured on this Plethora build (PLETHORA_HEALTH_OAUTH_BROKER_URL / server client credentials required).",
                id.display_name()
            ),
        )
    } else {
        (
            ProviderReadinessState::RequiresUserAuthorization,
            format!("Ready to authorize {} via OAuth 2.0", id.display_name()),
        )
    };

    HealthProviderInfo {
        id,
        category: ProviderCategory::CloudOauth,
        display_name: id.display_name().to_string(),
        supported_categories,
        readiness_state,
        readiness_reason,
        implementation_version: "1.0.0".to_string(),
        requires_approval,
        requires_credentials: true,
        supports_backfill: max_backfill_days.is_some(),
        max_backfill_days,
        bridged_via: vec![
            HealthProviderId::AppleHealthkit,
            HealthProviderId::AndroidHealthConnect,
        ],
        documentation_url: doc_url.to_string(),
        limitations,
    }
}

fn tier2_bridged_info(
    id: HealthProviderId,
    doc_url: &str,
    supported_categories: Vec<HealthDataCategory>,
    reason: &str,
) -> HealthProviderInfo {
    HealthProviderInfo {
        id,
        category: ProviderCategory::AggregatorBridged,
        display_name: id.display_name().to_string(),
        supported_categories,
        readiness_state: ProviderReadinessState::RequiresDeveloperApproval,
        readiness_reason: reason.to_string(),
        implementation_version: "1.0.0".to_string(),
        requires_approval: true,
        requires_credentials: true,
        supports_backfill: false,
        max_backfill_days: None,
        bridged_via: vec![
            HealthProviderId::AppleHealthkit,
            HealthProviderId::AndroidHealthConnect,
        ],
        documentation_url: doc_url.to_string(),
        limitations: vec![reason.to_string()],
    }
}
