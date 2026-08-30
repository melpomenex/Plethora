pub mod snapshot;

pub use snapshot::*;

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
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

/// Durable shape stored in the settings KV under [`SETTINGS_KEY`]: the last
/// server-verified snapshot per account. Device-local (denylisted from the
/// settings sync); never contains tokens.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct PersistedEntitlements {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    accounts: HashMap<String, EntitlementSnapshot>,
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

    /// Clear the active in-memory snapshot (sign-out): the session must not
    /// keep rendering the prior account's entitlements. Persisted per-account
    /// snapshots remain on disk for future logins of that account.
    pub fn clear_cached_snapshot(&self) {
        if let Ok(mut lock) = self.cached_snapshot.write() {
            *lock = None;
        }
    }

    /// Hydrate the in-memory cache from the durable per-account store for the
    /// given account, if the cache is empty. Called before any network
    /// attempt so a failed refresh can fall back to the persisted verified
    /// snapshot instead of manufacturing Free defaults.
    pub async fn hydrate_from_storage(
        &self,
        repo: &crate::database::Repository,
        account_id: &str,
    ) {
        if self
            .cached_snapshot
            .read()
            .ok()
            .and_then(|guard| guard.clone())
            .is_some()
        {
            return;
        }
        if let Ok(Some(raw)) = repo.get_setting(SETTINGS_KEY).await {
            if let Ok(persisted) = serde_json::from_str::<PersistedEntitlements>(&raw) {
                if let Some(snapshot) = persisted.accounts.get(account_id) {
                    let snapshot = snapshot.clone();
                    if let Ok(mut lock) = self.cached_snapshot.write() {
                        // Only fill an still-empty slot (another waiter may
                        // have won the race with a fresher value).
                        if lock.is_none() {
                            *lock = Some(snapshot);
                        }
                    }
                }
            }
        }
    }

    /// Persist the verified snapshot under its own account key. Never called
    /// for anonymous fallback snapshots (`account_id: None`).
    pub async fn persist_verified(
        &self,
        repo: &crate::database::Repository,
        snapshot: &EntitlementSnapshot,
    ) {
        let Some(account_id) = snapshot.account_id.clone() else {
            return;
        };
        let mut persisted = match repo.get_setting(SETTINGS_KEY).await {
            Ok(Some(raw)) => serde_json::from_str::<PersistedEntitlements>(&raw)
                .unwrap_or_default(),
            _ => PersistedEntitlements::default(),
        };
        if persisted.version == 0 {
            persisted.version = 1;
        }
        persisted.accounts.insert(account_id, snapshot.clone());
        if let Ok(json) = serde_json::to_string(&persisted) {
            if let Err(err) = repo.set_setting(SETTINGS_KEY, &json).await {
                eprintln!("[entitlements] failed to persist verified snapshot: {err}");
            }
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
                    // Grace period exceeded: cloud capabilities degrade to
                    // unavailable/offline, but the plan IDENTITY survives — a
                    // Pro subscriber offline for four days is still a Pro
                    // subscriber whose cloud features read as offline, not a
                    // Free user (openspec entitlement-persistence).
                    for (id, state) in snapshot.capabilities.iter_mut() {
                        let desc = get_descriptor(*id);
                        if desc.default_plan != "free" {
                            state.enabled = false;
                            state.reason = Some(CapabilityReason::Offline);
                        }
                    }
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
pub async fn entitlement_get_snapshot(
    cache: tauri::State<'_, Arc<EntitlementCache>>,
    auth: tauri::State<'_, Arc<crate::plethora_auth::AuthManager>>,
    repo: tauri::State<'_, crate::database::Repository>,
) -> Result<EntitlementSnapshot, String> {
    // Hydrate the durable verified snapshot for the signed-in account so a
    // cold process reads persisted state, not Free defaults.
    if let Some(account_id) = auth.get_user_id() {
        cache.hydrate_from_storage(&repo, &account_id).await;
    }
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

/// Typed transport failure for the entitlements fetch: 401 means "the bearer
/// we presented was rejected" (the caller should refresh the token and
/// retry), everything else is a network/server failure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EntitlementFetchError {
    Unauthorized,
    Transport(String),
}

impl std::fmt::Display for EntitlementFetchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EntitlementFetchError::Unauthorized => write!(f, "entitlements fetch: HTTP 401"),
            EntitlementFetchError::Transport(detail) => write!(f, "entitlements fetch failed: {detail}"),
        }
    }
}

/// Typed outcome of a native entitlement refresh. The frontend needs to
/// distinguish "authoritative new state" from "kept the old state because the
/// network failed" and "the token expired" — a bare snapshot cannot express
/// that, which is exactly how Free defaults used to masquerade as fresh.
#[derive(Debug, Clone, Serialize)]
// Internally tagged on `status`. NOTE: variant tags are pinned to snake_case
// explicitly — `rename_all = "camelCase"` here would also rename the VARIANTS
// ("staleCache"/"authExpired") and silently break the frontend's
// `status === 'auth_expired'` contract checks.
#[serde(tag = "status")]
pub enum EntitlementRefreshOutcome {
    /// Server 200 with a valid snapshot: cached in memory AND persisted.
    #[serde(rename = "verified")]
    Verified {
        snapshot: EntitlementSnapshot,
    },
    /// Signed in, fetch failed: retained snapshot with provenance intact.
    #[serde(rename = "stale_cache")]
    StaleCache {
        snapshot: EntitlementSnapshot,
    },
    /// Server rejected the presented bearer (401): caller refreshes + retries.
    #[serde(rename = "auth_expired")]
    AuthExpired {
        snapshot: EntitlementSnapshot,
    },
    /// No signed-in session: Free defaults, never cached or persisted.
    #[serde(rename = "anonymous")]
    Anonymous {
        snapshot: EntitlementSnapshot,
    },
}

/// GET /v1/entitlements with the account's bearer token.
///
/// Transport only — callers own caching/grace behavior. Pure HTTP so the
/// transport test drives it against a local server without a Tauri runtime.
pub async fn fetch_entitlements(
    base_url: &str,
    access_token: &str,
) -> Result<EntitlementSnapshot, EntitlementFetchError> {
    let url = format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        ENTITLEMENTS_PATH.trim_start_matches('/')
    );
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(ENTITLEMENT_FETCH_TIMEOUT_SECS))
        .build()
        .map_err(|e| EntitlementFetchError::Transport(format!("client build failed: {e}")))?;
    let resp = client
        .get(&url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| EntitlementFetchError::Transport(format!("network: {e}")))?;
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(EntitlementFetchError::Unauthorized);
    }
    if !resp.status().is_success() {
        return Err(EntitlementFetchError::Transport(format!(
            "HTTP {}",
            resp.status()
        )));
    }
    let server: ServerEntitlementSnapshot = resp
        .json()
        .await
        .map_err(|e| EntitlementFetchError::Transport(format!("decode failed: {e}")))?;
    EntitlementSnapshot::try_from(server).map_err(EntitlementFetchError::Transport)
}

#[tauri::command]
pub async fn entitlement_refresh(
    cache: tauri::State<'_, Arc<EntitlementCache>>,
    auth: tauri::State<'_, Arc<crate::plethora_auth::AuthManager>>,
    repo: tauri::State<'_, crate::database::Repository>,
) -> Result<EntitlementRefreshOutcome, String> {
    // Hydrate the durable verified snapshot for the signed-in account BEFORE
    // any network attempt, so a failing refresh below falls back to persisted
    // verified state rather than empty-cache Free defaults.
    if let Some(account_id) = auth.get_user_id() {
        cache.hydrate_from_storage(&repo, &account_id).await;
    }

    let Some(access_token) = auth.get_access_token() else {
        if auth.get_user_id().is_some() {
            // Signed in but no token mirrored yet (transient startup order):
            // retain the hydrated/persisted snapshot rather than answering
            // anonymous over a known account.
            return Ok(EntitlementRefreshOutcome::StaleCache {
                snapshot: cache.resolve(),
            });
        }
        // No signed-in session: anonymous Free defaults (with any local dev
        // overrides applied). Never cached, never persisted — an anonymous
        // snapshot must not enter the per-account store or pose as verified.
        return Ok(EntitlementRefreshOutcome::Anonymous {
            snapshot: cache.resolve(),
        });
    };

    match fetch_entitlements(&api_base_url(), &access_token).await {
        Ok(snapshot) => {
            // Apply-time account guard: a response fetched for account A must
            // never become the active snapshot of account B (or of a signed-
            // out session) if the session changed while the request was in
            // flight. It is still persisted under its OWN account key — that
            // is always correct.
            cache.persist_verified(&repo, &snapshot).await;
            let active_account = auth.get_user_id();
            let matches_active = snapshot
                .account_id
                .as_deref()
                .map(|id| Some(id) == active_account.as_deref())
                .unwrap_or(false);
            if matches_active {
                cache.set_cached_snapshot(snapshot.clone());
                Ok(EntitlementRefreshOutcome::Verified {
                    snapshot: cache.resolve(),
                })
            } else {
                // Session changed mid-flight: keep whatever is active now.
                Ok(EntitlementRefreshOutcome::Verified { snapshot })
            }
        }
        Err(EntitlementFetchError::Unauthorized) => {
            // Token expired/invalid: NOT a downgrade. The frontend refreshes
            // the access token and retries once; nothing is cached or stamped.
            Ok(EntitlementRefreshOutcome::AuthExpired {
                snapshot: cache.resolve(),
            })
        }
        Err(err) => {
            // Network/server failure: keep the retained snapshot with its
            // original provenance and fetched_at. Never stamp fallbacks as
            // fresh, never cache Free defaults over a verified snapshot.
            eprintln!("[entitlements] refresh failed, keeping cached snapshot: {err}");
            Ok(EntitlementRefreshOutcome::StaleCache {
                snapshot: cache.resolve(),
            })
        }
    }
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

    #[test]
    fn snapshot_wire_format_is_camel_case() {
        // The frontend types (src/types/entitlements.ts) expect fetchedAt /
        // accountId / expiresAt — snake_case here silently breaks capability
        // resolution client-side.
        let snapshot = EntitlementSnapshot {
            account_id: Some("user-1".to_string()),
            plan: "pro".to_string(),
            capabilities: HashMap::new(),
            fetched_at: "2026-08-30T00:00:00Z".to_string(),
            expires_at: Some("2026-08-30T00:15:00Z".to_string()),
            source: SnapshotSource::Server,
        };
        let json = serde_json::to_value(&snapshot).unwrap();
        assert!(json.get("fetchedAt").is_some(), "missing fetchedAt: {json}");
        assert!(json.get("accountId").is_some(), "missing accountId: {json}");
        assert!(json.get("expiresAt").is_some(), "missing expiresAt: {json}");
        let round: EntitlementSnapshot = serde_json::from_value(json).unwrap();
        assert_eq!(round, snapshot);
    }

    #[test]
    fn refresh_outcome_wire_tags_are_snake_case() {
        // The frontend matches outcome.status === 'auth_expired' etc. A serde
        // rename_all slip here silently disables the 401→refresh→retry path.
        let snapshot = create_free_default_snapshot();
        let cases = [
            (EntitlementRefreshOutcome::Verified { snapshot: snapshot.clone() }, "verified"),
            (EntitlementRefreshOutcome::StaleCache { snapshot: snapshot.clone() }, "stale_cache"),
            (EntitlementRefreshOutcome::AuthExpired { snapshot: snapshot.clone() }, "auth_expired"),
            (EntitlementRefreshOutcome::Anonymous { snapshot }, "anonymous"),
        ];
        for (outcome, expected) in cases {
            let json = serde_json::to_value(&outcome).unwrap();
            assert_eq!(
                json.get("status").and_then(|v| v.as_str()),
                Some(expected),
                "wire tag mismatch: {json}"
            );
        }
    }

    #[test]
    fn past_grace_preserves_plan_identity() {
        let cache = EntitlementCache::new();
        let mut snapshot = create_free_default_snapshot();
        snapshot.account_id = Some("u1".to_string());
        snapshot.plan = "pro".to_string();
        snapshot.fetched_at = (Utc::now() - Duration::hours(80)).to_rfc3339();
        cache.set_cached_snapshot(snapshot);

        let resolved = cache.resolve();
        // Identity survives; only cloud capabilities degrade.
        assert_eq!(resolved.plan, "pro");
        assert_eq!(resolved.account_id.as_deref(), Some("u1"));
        let cloud_sync = resolved.capabilities.get(&CapabilityId::CloudSync).unwrap();
        assert!(!cloud_sync.enabled);
        assert_eq!(cloud_sync.reason, Some(CapabilityReason::Offline));
    }

    #[test]
    fn clear_cached_snapshot_yields_free_defaults() {
        let cache = EntitlementCache::new();
        let mut snapshot = create_free_default_snapshot();
        snapshot.plan = "pro".to_string();
        cache.set_cached_snapshot(snapshot);
        cache.clear_cached_snapshot();
        assert_eq!(cache.resolve().plan, "free");
        assert_eq!(cache.resolve().source, SnapshotSource::LocalDefaults);
    }

    /// In-memory pool with the settings KV table the durable cache uses.
    async fn settings_pool() -> sqlx::SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open in-memory database");
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                date_modified TEXT NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .expect("create settings table");
        pool
    }

    fn verified_pro_snapshot(account: &str) -> EntitlementSnapshot {
        let mut snapshot = create_free_default_snapshot();
        snapshot.account_id = Some(account.to_string());
        snapshot.plan = "pro".to_string();
        snapshot.source = SnapshotSource::Server;
        snapshot.fetched_at = Utc::now().to_rfc3339();
        snapshot
    }

    #[tokio::test]
    async fn durable_snapshot_survives_process_recreation() {
        let pool = settings_pool().await;
        let repo = crate::database::Repository::new(pool.clone());

        // "Process 1": persist a verified Pro snapshot for account A.
        let cache = EntitlementCache::new();
        cache
            .persist_verified(&repo, &verified_pro_snapshot("account-a"))
            .await;

        // "Process 2": a fresh cache (empty memory) hydrates from storage.
        let cache2 = EntitlementCache::new();
        cache2.hydrate_from_storage(&repo, "account-a").await;
        let resolved = cache2.resolve();
        assert_eq!(resolved.plan, "pro");
        assert_eq!(resolved.account_id.as_deref(), Some("account-a"));
        assert_eq!(resolved.source, SnapshotSource::Server);
    }

    #[tokio::test]
    async fn persisted_snapshots_are_account_scoped() {
        let pool = settings_pool().await;
        let repo = crate::database::Repository::new(pool.clone());

        let cache = EntitlementCache::new();
        cache
            .persist_verified(&repo, &verified_pro_snapshot("account-a"))
            .await;

        // Account B's fresh cache must NOT read A's slot…
        let cache_b = EntitlementCache::new();
        cache_b.hydrate_from_storage(&repo, "account-b").await;
        assert_eq!(cache_b.resolve().plan, "free");
        assert_eq!(cache_b.resolve().source, SnapshotSource::LocalDefaults);

        // …but logging back into A restores the verified state.
        let cache_a = EntitlementCache::new();
        cache_a.hydrate_from_storage(&repo, "account-a").await;
        assert_eq!(cache_a.resolve().plan, "pro");
    }

    #[tokio::test]
    async fn anonymous_snapshots_are_never_persisted() {
        let pool = settings_pool().await;
        let repo = crate::database::Repository::new(pool.clone());

        let cache = EntitlementCache::new();
        cache
            .persist_verified(&repo, &create_free_default_snapshot())
            .await;

        let stored = repo.get_setting(SETTINGS_KEY).await.unwrap();
        assert!(
            stored.is_none(),
            "anonymous fallback must never enter the durable store"
        );
    }

    #[tokio::test]
    async fn hydrate_never_overwrites_an_occupied_slot() {
        let pool = settings_pool().await;
        let repo = crate::database::Repository::new(pool.clone());

        let cache = EntitlementCache::new();
        let live = verified_pro_snapshot("account-a");
        cache.set_cached_snapshot(live.clone());
        cache
            .persist_verified(&repo, &verified_pro_snapshot("account-a"))
            .await;

        cache.hydrate_from_storage(&repo, "account-a").await;
        // The in-memory (newer) snapshot wins; hydration only fills empties.
        assert_eq!(cache.resolve().fetched_at, live.fetched_at);
    }

    #[tokio::test]
    async fn stale_cache_outcome_does_not_touch_fetched_at() {
        // Provenance rule: a failed refresh must never make an old snapshot
        // look newly verified. The refresh command's stale_cache arm returns
        // cache.resolve() without writing — pinned by the command's outcome
        // shape plus this resolution behavior.
        let cache = EntitlementCache::new();
        let mut snapshot = verified_pro_snapshot("account-a");
        snapshot.fetched_at = (Utc::now() - Duration::hours(1)).to_rfc3339();
        cache.set_cached_snapshot(snapshot.clone());

        let resolved = cache.resolve();
        assert_eq!(resolved.fetched_at, snapshot.fetched_at);
        assert_eq!(resolved.plan, "pro");
    }

    #[tokio::test]
    async fn unauthorized_fetch_error_is_distinguishable() {
        let response: &'static [u8] =
            b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        let url = serve_one(response);
        let err = fetch_entitlements(&url, "expired-jwt").await.unwrap_err();
        assert_eq!(err, EntitlementFetchError::Unauthorized);
    }

    #[tokio::test]
    async fn test_fetch_entitlements_transport_surfaces_http_errors() {
        let response: &'static [u8] =
            b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        let url = serve_one(response);
        let err = fetch_entitlements(&url, "test-jwt").await.unwrap_err();
        assert!(
            matches!(&err, EntitlementFetchError::Transport(detail) if detail.contains("500")),
            "unexpected error: {err}"
        );
    }
}
