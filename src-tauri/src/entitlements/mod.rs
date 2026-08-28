pub mod snapshot;

pub use snapshot::*;

use chrono::{DateTime, Duration, Utc};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

pub const SETTINGS_KEY: &str = "plethora.entitlements";
pub const OFFLINE_GRACE_DURATION_HOURS: i64 = 72;
pub const TTL_MINUTES: i64 = 15;

#[derive(Debug, Clone)]
pub struct EntitlementCache {
    cached_snapshot: Arc<RwLock<Option<EntitlementSnapshot>>>,
    overrides: Arc<RwLock<HashMap<CapabilityId, bool>>>,
}

impl Default for EntitlementCache {
    fn default() -> Self {
        Self::new()
    }
}

impl EntitlementCache {
    pub fn new() -> Self {
        Self {
            cached_snapshot: Arc::new(RwLock::new(None)),
            overrides: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn set_cached_snapshot(&self, snapshot: EntitlementSnapshot) {
        if let Ok(mut lock) = self.cached_snapshot.write() {
            *lock = Some(snapshot);
        }
    }

    pub fn set_override(&self, capability: CapabilityId, enabled: bool) {
        if let Ok(mut lock) = self.overrides.write() {
            lock.insert(capability, enabled);
        }
    }

    pub fn clear_override(&self, capability: Option<CapabilityId>) {
        if let Ok(mut lock) = self.overrides.write() {
            if let Some(id) = capability {
                lock.remove(&id);
            } else {
                lock.clear();
            }
        }
    }

    pub fn is_enabled(&self, capability: CapabilityId) -> bool {
        let snapshot = self.resolve();
        snapshot
            .capabilities
            .get(&capability)
            .map(|state| state.enabled)
            .unwrap_or(false)
    }

    pub fn resolve(&self) -> EntitlementSnapshot {
        let now = Utc::now();
        let cached = self
            .cached_snapshot
            .read()
            .ok()
            .and_then(|guard| guard.clone());

        let mut base_snapshot = match cached {
            Some(mut snapshot) => {
                let fetched_time = DateTime::parse_from_rfc3339(&snapshot.fetched_at)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or(now);

                let age = now.signed_duration_since(fetched_time);
                let grace_limit = Duration::hours(OFFLINE_GRACE_DURATION_HOURS);
                let ttl = Duration::minutes(TTL_MINUTES);

                if age <= ttl {
                    snapshot
                } else if age <= grace_limit {
                    snapshot.source = SnapshotSource::Grace;
                    snapshot
                } else {
                    // Grace period exceeded: revert cloud capabilities to Free plan fallbacks
                    let free_defaults = create_free_default_snapshot();
                    for (id, state) in snapshot.capabilities.iter_mut() {
                        let desc = get_descriptor(*id);
                        if desc.default_plan != "free" {
                            state.enabled = false;
                            state.reason = Some(CapabilityReason::Offline);
                        }
                    }
                    snapshot.plan = free_defaults.plan;
                    snapshot.source = SnapshotSource::Grace;
                    snapshot
                }
            }
            None => create_free_default_snapshot(),
        };

        // Apply local dev overrides on top of the resolved base snapshot
        if let Ok(overrides) = self.overrides.read() {
            if !overrides.is_empty() {
                base_snapshot.source = SnapshotSource::Override;
                for (&id, &enabled) in overrides.iter() {
                    let entry = base_snapshot
                        .capabilities
                        .entry(id)
                        .or_insert_with(|| CapabilityState {
                            enabled,
                            reason: None,
                            quota: None,
                        });
                    entry.enabled = enabled;
                    if enabled {
                        entry.reason = None;
                    } else {
                        entry.reason = Some(CapabilityReason::Plan);
                    }
                }
            }
        }

        base_snapshot
    }
}

// -----------------------------------------------------------------------------
// Tauri Commands
// -----------------------------------------------------------------------------

#[tauri::command]
pub fn entitlement_get_snapshot(
    cache: tauri::State<Arc<EntitlementCache>>,
) -> Result<EntitlementSnapshot, String> {
    Ok(cache.resolve())
}

/// Server API path for the authoritative entitlement snapshot.
pub const ENTITLEMENTS_PATH: &str = "/v1/entitlements";
/// Fetch timeout — entitlement refresh must never block startup UX.
pub const ENTITLEMENT_FETCH_TIMEOUT_SECS: u64 = 8;

/// Server base URL. Mirrors the frontend default
/// (`src/config/product.ts` PLETHORA_API_URL).
fn api_base_url() -> String {
    std::env::var("PLETHORA_API_URL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "https://api.useplethora.com".to_string())
}

/// The server's `/v1/entitlements` payload shape (camelCase over the wire —
/// see server/src/routes/v1/entitlements.ts). Distinct from
/// [`EntitlementSnapshot`] so the wire contract stays explicit.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerEntitlementSnapshot {
    #[serde(default)]
    account_id: Option<String>,
    plan: String,
    #[serde(default)]
    capabilities: HashMap<String, ServerCapabilityState>,
    fetched_at: String,
    #[serde(default)]
    expires_at: Option<String>,
    #[serde(default)]
    source: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct ServerCapabilityState {
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    quota: Option<serde_json::Value>,
}

impl TryFrom<ServerEntitlementSnapshot> for EntitlementSnapshot {
    type Error = String;

    fn try_from(server: ServerEntitlementSnapshot) -> Result<Self, Self::Error> {
        let mut capabilities = HashMap::new();
        for (key, state) in server.capabilities {
            let Some(id) = CapabilityId::from_str_opt(&key) else {
                // Unknown capability ids are ignored (forward compatibility).
                continue;
            };
            let reason = match state.reason.as_deref() {
                None | Some("") => None,
                Some("plan") => Some(CapabilityReason::Plan),
                Some("offline") => Some(CapabilityReason::Offline),
                Some(_) => None,
            };
            capabilities.insert(
                id,
                CapabilityState {
                    enabled: state.enabled,
                    reason,
                    quota: None,
                },
            );
        }
        let source = match server.source.as_deref() {
            Some("cache") => SnapshotSource::Cache,
            Some("grace") => SnapshotSource::Grace,
            _ => SnapshotSource::Server,
        };
        if capabilities.is_empty() {
            return Err("server snapshot carried no known capabilities".to_string());
        }
        Ok(EntitlementSnapshot {
            account_id: server.account_id,
            plan: server.plan,
            capabilities,
            fetched_at: server.fetched_at,
            expires_at: server.expires_at,
            source,
        })
    }
}

/// GET /v1/entitlements with the account's bearer token.
///
/// Transport only — callers own caching/grace behavior. Pure HTTP so the
/// transport test drives it against a local server without a Tauri runtime.
pub async fn fetch_entitlements(
    base_url: &str,
    access_token: &str,
) -> Result<EntitlementSnapshot, String> {
    let url = format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        ENTITLEMENTS_PATH.trim_start_matches('/')
    );
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(ENTITLEMENT_FETCH_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("entitlements client build failed: {e}"))?;
    let resp = client
        .get(&url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("entitlements fetch failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("entitlements fetch failed: HTTP {}", resp.status()));
    }
    let server: ServerEntitlementSnapshot = resp
        .json()
        .await
        .map_err(|e| format!("entitlements decode failed: {e}"))?;
    EntitlementSnapshot::try_from(server)
}

#[tauri::command]
pub async fn entitlement_refresh(
    cache: tauri::State<'_, Arc<EntitlementCache>>,
    auth: tauri::State<'_, Arc<crate::plethora_auth::AuthManager>>,
) -> Result<EntitlementSnapshot, String> {
    // Authoritative path (implement-native-ios-storekit2-billing §6.7): when
    // an account session exists, GET /v1/entitlements and cache the verified
    // server snapshot. On any transport failure the cached snapshot survives
    // (offline relaunch uses the cache within TTL/grace per design §5).
    if let Some(access_token) = auth.get_access_token() {
        match fetch_entitlements(&api_base_url(), &access_token).await {
            Ok(snapshot) => {
                cache.set_cached_snapshot(snapshot.clone());
                return Ok(cache.resolve());
            }
            Err(err) => {
                eprintln!("[entitlements] refresh failed, keeping cached snapshot: {err}");
            }
        }
    }

    // Fallback (no session or fetch failure): previous behavior — re-stamp the
    // resolved snapshot so local overrides remain effective.
    let mut current = cache.resolve();
    current.fetched_at = Utc::now().to_rfc3339();
    cache.set_cached_snapshot(current.clone());
    Ok(cache.resolve())
}

#[tauri::command]
pub fn entitlement_override_set(
    cache: tauri::State<Arc<EntitlementCache>>,
    capability: String,
    enabled: bool,
) -> Result<EntitlementSnapshot, String> {
    let id = CapabilityId::from_str_opt(&capability)
        .ok_or_else(|| format!("Unknown capability: {capability}"))?;
    cache.set_override(id, enabled);
    Ok(cache.resolve())
}

#[tauri::command]
pub fn entitlement_override_clear(
    cache: tauri::State<Arc<EntitlementCache>>,
    capability: Option<String>,
) -> Result<EntitlementSnapshot, String> {
    let id = match capability {
        Some(cap) => Some(
            CapabilityId::from_str_opt(&cap)
                .ok_or_else(|| format!("Unknown capability: {cap}"))?,
        ),
        None => None,
    };
    cache.clear_override(id);
    Ok(cache.resolve())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_capability_ids_match_string_representation() {
        for &id in CapabilityId::ALL {
            let s = id.as_str();
            assert_eq!(CapabilityId::from_str_opt(s), Some(id));
        }
        assert_eq!(CapabilityId::from_str_opt("non_existent"), None);
    }

    #[test]
    fn test_default_snapshot_resolves_all_capabilities_disabled_for_pro() {
        let cache = EntitlementCache::new();
        let snapshot = cache.resolve();
        assert_eq!(snapshot.plan, "free");
        assert_eq!(snapshot.source, SnapshotSource::LocalDefaults);

        for &id in CapabilityId::ALL {
            let desc = get_descriptor(id);
            let state = snapshot.capabilities.get(&id).unwrap();
            if desc.default_plan == "free" {
                assert!(state.enabled);
                assert!(state.reason.is_none());
            } else {
                assert!(!state.enabled);
                assert_eq!(state.reason, Some(CapabilityReason::Plan));
            }
        }
    }

    #[test]
    fn test_override_precedence() {
        let cache = EntitlementCache::new();
        assert!(!cache.is_enabled(CapabilityId::CloudSync));

        // Override CloudSync to enabled
        cache.set_override(CapabilityId::CloudSync, true);
        let snapshot = cache.resolve();
        assert_eq!(snapshot.source, SnapshotSource::Override);
        assert!(cache.is_enabled(CapabilityId::CloudSync));
        assert!(snapshot.capabilities.get(&CapabilityId::CloudSync).unwrap().enabled);

        // Clear specific override
        cache.clear_override(Some(CapabilityId::CloudSync));
        assert!(!cache.is_enabled(CapabilityId::CloudSync));
    }

    #[test]
    fn test_offline_grace_resolution() {
        let cache = EntitlementCache::new();
        let mut mock_snapshot = create_free_default_snapshot();
        mock_snapshot.plan = "pro".to_string();
        mock_snapshot.capabilities.insert(
            CapabilityId::CloudSync,
            CapabilityState {
                enabled: true,
                reason: None,
                quota: None,
            },
        );

        // Within grace period (e.g. 24h ago)
        let past_24h = (Utc::now() - Duration::hours(24)).to_rfc3339();
        mock_snapshot.fetched_at = past_24h;
        cache.set_cached_snapshot(mock_snapshot.clone());

        let resolved = cache.resolve();
        assert_eq!(resolved.source, SnapshotSource::Grace);
        assert!(resolved.capabilities.get(&CapabilityId::CloudSync).unwrap().enabled);

        // Past grace period (e.g. 80h ago)
        let past_80h = (Utc::now() - Duration::hours(80)).to_rfc3339();
        mock_snapshot.fetched_at = past_80h;
        cache.set_cached_snapshot(mock_snapshot);

        let resolved_expired = cache.resolve();
        assert_eq!(resolved_expired.source, SnapshotSource::Grace);
        // CloudSync is a pro capability, so it degrades to disabled with reason offline
        let cloud_sync_state = resolved_expired
            .capabilities
            .get(&CapabilityId::CloudSync)
            .unwrap();
        assert!(!cloud_sync_state.enabled);
        assert_eq!(cloud_sync_state.reason, Some(CapabilityReason::Offline));
    }

    /// Serve exactly one HTTP response on an ephemeral port; returns the URL.
    fn serve_one(response: &'static [u8]) -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            use std::io::{Read, Write};
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(2)))
                .unwrap();
            let mut buf = [0u8; 4096];
            // Read the request head (single small request fits one read).
            let _ = stream.read(&mut buf);
            stream.write_all(response).unwrap();
        });
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn test_fetch_entitlements_transport_parses_server_snapshot() {
        let body = r#"{"accountId":"user-1","plan":"pro","capabilities":{"cloud_sync":{"enabled":true},"api_access":{"enabled":false,"reason":"plan"}},"fetchedAt":"2026-01-01T00:00:00Z","expiresAt":null,"source":"server"}"#;
        let response: &'static [u8] = Box::leak(
            format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .into_boxed_str()
            .into_boxed_bytes(),
        );
        let url = serve_one(response);

        let snapshot = fetch_entitlements(&url, "test-jwt").await.unwrap();
        assert_eq!(snapshot.plan, "pro");
        assert_eq!(snapshot.account_id.as_deref(), Some("user-1"));
        assert_eq!(snapshot.source, SnapshotSource::Server);
        assert!(snapshot.capabilities.get(&CapabilityId::CloudSync).unwrap().enabled);
        let api_access = snapshot.capabilities.get(&CapabilityId::ApiAccess).unwrap();
        assert!(!api_access.enabled);
        assert_eq!(api_access.reason, Some(CapabilityReason::Plan));
    }

    #[tokio::test]
    async fn test_fetch_entitlements_transport_surfaces_http_errors() {
        let response: &'static [u8] =
            b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        let url = serve_one(response);
        let err = fetch_entitlements(&url, "test-jwt").await.unwrap_err();
        assert!(err.contains("500"), "unexpected error: {err}");
    }
}
