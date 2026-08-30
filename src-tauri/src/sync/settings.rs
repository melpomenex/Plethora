/// Settings keys that must never leave the device (API keys, paths, machine ids).
const DEVICE_LOCAL_DENYLIST: &[&str] = &[
    "openrouter.apiKey",
    "openrouter.api_key",
    "anthropic.apiKey",
    "google.apiKey",
    "backup.lastPath",
    "backup.last_path",
    "device.id",
    "device.fingerprint",
    "transcription.localModelPath",
    "ocr.modelPath",
    "hf.token",
    "plethora.recoveryKey",
    "sync.recoveryKey",
    // Per-device explicit opt-in (language-learning gating): an older
    // install's synced settings object predates the field and must never
    // unset this device's choice.
    "languageLearning.enabled",
    // Durable per-account entitlement snapshots are device-local cache state;
    // the server is authoritative and each device refreshes independently.
    "plethora.entitlements",
];

pub fn is_syncable_setting_key(key: &str) -> bool {
    let normalized = key.trim();
    if normalized.is_empty() {
        return false;
    }
    !DEVICE_LOCAL_DENYLIST
        .iter()
        .any(|deny| normalized.eq_ignore_ascii_case(deny) || normalized.starts_with(&format!("{deny}.")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn denies_api_keys_and_device_paths() {
        assert!(!is_syncable_setting_key("openrouter.apiKey"));
        assert!(!is_syncable_setting_key("backup.lastPath"));
        assert!(is_syncable_setting_key("theme.mode"));
        assert!(is_syncable_setting_key("tas.enabled"));
    }
}
