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

#[tauri::command]
pub fn entitlement_refresh(
    cache: tauri::State<Arc<EntitlementCache>>,
) -> Result<EntitlementSnapshot, String> {
    // In Proposal 2, refresh returns current resolved snapshot with updated fetched_at.
    // In Proposal 3, this issues GET /v1/entitlements against the authenticated account.
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
}
