/// Gate v2 delta sync until explicitly enabled (Phase 2 harness / staged rollout).
pub fn sync_v2_enabled() -> bool {
    match std::env::var("PLETHORA_SYNC_V2") {
        Ok(value) => {
            let normalized = value.trim().to_ascii_lowercase();
            normalized == "1" || normalized == "true" || normalized == "yes"
        }
        Err(_) => false,
    }
}
