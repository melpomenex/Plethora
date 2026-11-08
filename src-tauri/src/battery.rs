use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicUsize, Ordering};

/// Battery and thermal state exposed to the frontend and internal background schedulers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatteryState {
    pub is_present: bool,
    pub level: f32, // 0.0 – 1.0
    pub is_charging: bool,
    #[serde(default)]
    pub is_power_save: bool,
    #[serde(default = "default_thermal_status")]
    pub thermal_status: String, // "normal" | "light" | "moderate" | "severe" | "critical"
}

fn default_thermal_status() -> String {
    "normal".to_string()
}

impl Default for BatteryState {
    fn default() -> Self {
        Self {
            is_present: false,
            level: 1.0,
            is_charging: true,
            is_power_save: false,
            thermal_status: "normal".to_string(),
        }
    }
}

// 0: normal, 1: light, 2: moderate, 3: severe, 4: critical
static CACHED_THERMAL_STATUS_CODE: AtomicUsize = AtomicUsize::new(0);

/// Update the atomic cached thermal status string from Android JNI or iOS Swift bridges.
pub fn update_cached_thermal_status(status: &str) {
    let code = match status.to_lowercase().as_str() {
        "normal" => 0,
        "light" => 1,
        "moderate" => 2,
        "severe" => 3,
        "critical" => 4,
        _ => 0,
    };
    CACHED_THERMAL_STATUS_CODE.store(code, Ordering::Relaxed);
}

/// Retrieve the current atomic cached thermal status ("normal", "light", "moderate", "severe", "critical").
pub fn get_cached_thermal_status() -> &'static str {
    match CACHED_THERMAL_STATUS_CODE.load(Ordering::Relaxed) {
        0 => "normal",
        1 => "light",
        2 => "moderate",
        3 => "severe",
        4 => "critical",
        _ => "normal",
    }
}

/// Returns true if device is experiencing severe or critical thermal pressure.
pub fn is_thermal_throttled() -> bool {
    CACHED_THERMAL_STATUS_CODE.load(Ordering::Relaxed) >= 3
}

/// Returns true if device is experiencing critical thermal pressure.
pub fn is_critically_throttled() -> bool {
    CACHED_THERMAL_STATUS_CODE.load(Ordering::Relaxed) >= 4
}

// Desktop implementation: the `battery` crate has no Android/iOS backend.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
/// Tauri command: read current battery state via the `battery` crate on desktop platforms.
#[tauri::command]
pub fn get_battery_state() -> BatteryState {
    let thermal_status = get_cached_thermal_status().to_string();
    match battery::Manager::new().and_then(|mgr| mgr.batteries()) {
        Ok(mut bats) => match bats.next() {
            Some(Ok(bat)) => {
                let state = bat.state();
                let is_charging = matches!(state, battery::State::Charging | battery::State::Full);
                BatteryState {
                    is_present: true,
                    level: bat.state_of_charge().value,
                    is_charging,
                    is_power_save: false,
                    thermal_status,
                }
            }
            _ => BatteryState {
                is_present: false,
                level: 1.0,
                is_charging: true,
                is_power_save: false,
                thermal_status,
            },
        },
        Err(_) => BatteryState {
            is_present: false,
            level: 1.0,
            is_charging: true,
            is_power_save: false,
            thermal_status,
        },
    }
}

// Android native JNI callback hook
#[cfg(target_os = "android")]
#[no_mangle]
pub extern "C" fn Java_app_plethora_battery_PlethoraBatteryBridge_nativeOnThermalStatusChanged(
    _env: jni::JNIEnv,
    _class: jni::objects::JClass,
    status_code: jni::sys::jint,
) {
    let status_str = match status_code {
        0 => "normal",
        1 => "light",
        2 => "moderate",
        3 => "severe",
        4..=6 => "critical",
        _ => "normal",
    };
    update_cached_thermal_status(status_str);
}

// Android implementation: reads cached thermal state and native battery signals.
#[cfg(target_os = "android")]
#[tauri::command]
pub fn get_battery_state() -> BatteryState {
    BatteryState {
        is_present: true,
        level: 1.0,
        is_charging: true,
        is_power_save: false,
        thermal_status: get_cached_thermal_status().to_string(),
    }
}

// iOS implementation: reads from Swift bridge via FFI.
#[cfg(target_os = "ios")]
extern "C" {
    fn plethora_get_ios_battery_info() -> *mut std::os::raw::c_char;
}

#[cfg(target_os = "ios")]
#[tauri::command]
pub fn get_battery_state() -> BatteryState {
    unsafe {
        let ptr = plethora_get_ios_battery_info();
        if !ptr.is_null() {
            let c_str = std::ffi::CStr::from_ptr(ptr);
            if let Ok(str_slice) = c_str.to_str() {
                if let Ok(state) = serde_json::from_str::<BatteryState>(str_slice) {
                    libc::free(ptr as *mut libc::c_void);
                    return state;
                }
            }
            libc::free(ptr as *mut libc::c_void);
        }
    }
    BatteryState {
        is_present: true,
        level: 1.0,
        is_charging: true,
        is_power_save: false,
        thermal_status: get_cached_thermal_status().to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_thermal_caching_and_throttling_transitions() {
        update_cached_thermal_status("normal");
        assert_eq!(get_cached_thermal_status(), "normal");
        assert!(!is_thermal_throttled());
        assert!(!is_critically_throttled());

        update_cached_thermal_status("light");
        assert_eq!(get_cached_thermal_status(), "light");
        assert!(!is_thermal_throttled());

        update_cached_thermal_status("moderate");
        assert_eq!(get_cached_thermal_status(), "moderate");
        assert!(!is_thermal_throttled());

        update_cached_thermal_status("severe");
        assert_eq!(get_cached_thermal_status(), "severe");
        assert!(is_thermal_throttled());
        assert!(!is_critically_throttled());

        update_cached_thermal_status("critical");
        assert_eq!(get_cached_thermal_status(), "critical");
        assert!(is_thermal_throttled());
        assert!(is_critically_throttled());

        // Restore to normal
        update_cached_thermal_status("normal");
        assert_eq!(get_cached_thermal_status(), "normal");
        assert!(!is_thermal_throttled());
    }

    #[test]
    fn test_battery_state_serialization() {
        let state = BatteryState {
            is_present: true,
            level: 0.85,
            is_charging: false,
            is_power_save: true,
            thermal_status: "severe".to_string(),
        };

        let json = serde_json::to_string(&state).expect("serialize battery state");
        assert!(json.contains("\"isPresent\":true"));
        assert!(json.contains("\"isPowerSave\":true"));
        assert!(json.contains("\"thermalStatus\":\"severe\""));

        let deserialized: BatteryState = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(state, deserialized);
    }
}
