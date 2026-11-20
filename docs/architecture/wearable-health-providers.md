# Wearable health provider integration

The native app opens a separate SQLite vault at `health/health.db`. Commands in `src-tauri/src/commands/health.rs` handle local records and read-only analytics. `health_sources.rs` owns native permission and synchronization flows. `health_cloud.rs` owns browser authorization and direct API synchronization. The provider catalog is the source for Settings readiness and supported categories.

## Native sources

- iOS uses the `plethora-healthkit` plugin and read-only HealthKit queries. Raw sleep sample UUIDs and the query anchor are committed with each delta so the vault can rebuild grouped sessions after a sample is deleted. Apple's read authorization is intentionally opaque to the app. The feature stays disabled in `scripts/ios-overrides/healthkit.entitlements.json` until a signed build has passed entitlement, purpose string, privacy, and physical-device checks.
- Android uses the `plethora-healthconnect` plugin. Check SDK availability and the permissions in Health Connect before diagnosing empty data. The initial read covers up to 30 days with standard permission. An explicit older-history grant allows up to 90 days. Changes use the platform cursor and tombstone the affected local records. An expired cursor triggers a bounded snapshot.

## Cloud sources

Set `PLETHORA_HEALTH_OAUTH_BROKER_URL` to the HTTPS broker including its `/v1/health-oauth` route. The broker must expose `GET /providers` and the provider-specific `exchange`, `refresh`, `revoke`, and webhook handlers. Configure OAuth credentials on the broker only. Its public provider directory exposes approved public client IDs and readiness. The client uses PKCE S256 and single-use state. Register callback URLs permitted by the provider for the desktop loopback or mobile app flow.

Add a provider by implementing `CloudHealthConnector`, registering its supported categories and readiness in `health/providers/catalog.rs`, and mapping its data into `NormalizedIngestionBatch`. Use stable provider record IDs, original source time offsets, provider-specific recovery scales, and explicit RMSSD or SDNN method labels. Use the shared HTTP client for bounded pagination, response-size limits, and rate-limit handling. Mock the upstream contract before testing with an authorized vendor account.

Google uses Health API v4 data points, including separate resting heart rate and heart rate variability data types. Garmin is approval-gated. Its catalog advertises sleep and recovery from the sleep summary. Connecting its HRV and resting heart-rate feeds requires the approved commercial contract and an account for verification. Deploy the private broker and validate sign-in, refresh, consent withdrawal, scope loss, and vendor limits against credentials approved for release. [Google Health API data points](https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints) · [Garmin Health API](https://developer.garmin.com/gc-developer-program/enterprise/health-api/)

See [Privacy Architecture](../PRIVACY_ARCHITECTURE.md) for storage, egress, and deletion. See the [wearable health product guide](../product/features/platform/wearable-health-insights.md) for the user workflow.
