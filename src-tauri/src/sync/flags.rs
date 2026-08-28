/// Gate v2 delta sync. When `PLETHORA_SYNC_V2` is unset, Pro entitlement enables sync.
pub fn sync_v2_enabled(pro_entitled: Option<bool>) -> bool {
    match std::env::var("PLETHORA_SYNC_V2") {
        Ok(value) => {
            let normalized = value.trim().to_ascii_lowercase();
            if normalized == "0" || normalized == "false" || normalized == "no" {
                return false;
            }
            normalized == "1" || normalized == "true" || normalized == "yes"
        }
        Err(_) => pro_entitled.unwrap_or(false),
    }
}

pub fn sync_v2_force_disabled() -> bool {
    matches!(
        std::env::var("PLETHORA_SYNC_V2").ok().as_deref(),
        Some("0") | Some("false") | Some("no")
    )
}
