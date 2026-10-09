use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, PluginApi, TauriPlugin},
    AppHandle, Manager, State, Wry,
};

#[cfg(any(target_os = "android", target_os = "ios"))]
use tauri::plugin::PluginHandle;

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.plethora.haptics";

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_plethora_haptics);

pub const PROTOCOL_VERSION: u32 = 1;
pub const MAX_ID_LENGTH: usize = 128;
pub const MAX_TTL_MS: u16 = 150;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum HapticEffect {
    Selection,
    Activation,
    Threshold,
    Commit,
    Success,
    Warning,
    Error,
    Completion,
    Celebration,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum HapticIntensity {
    Subtle,
    Standard,
    Strong,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum HapticSupport {
    Available,
    Unavailable,
    Unknown,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SystemPreference {
    Enabled,
    Disabled,
    Unknown,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum IntensityControl {
    EffectStyle,
    Fixed,
    None,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DriverKind {
    AndroidNative,
    IosNative,
    Browser,
    None,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SkipReason {
    Unsupported,
    Disabled,
    Background,
    Stale,
    RateLimited,
    SystemSuppressed,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HapticCapabilities {
    pub protocol_version: u32,
    pub driver: DriverKind,
    pub driver_session_id: String,
    pub configuration_revision: u64,
    pub hardware: HapticSupport,
    pub system_preference: SystemPreference,
    pub intensity_control: IntensityControl,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HapticConfiguration {
    pub driver_session_id: String,
    pub revision: u64,
    pub enabled: bool,
    pub intensity: HapticIntensity,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeHapticRequest {
    pub driver_session_id: String,
    pub revision: u64,
    pub interaction_id: String,
    pub effect: HapticEffect,
    pub ttl_ms: u16,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeHapticResult {
    pub status: ResultStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<SkipReason>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ResultStatus {
    Submitted,
    Skipped,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConfigureResult {
    driver_session_id: String,
    revision: u64,
}

fn validate_id(id: &str) -> Result<(), String> {
    if id.trim().is_empty() || id.len() > MAX_ID_LENGTH {
        return Err(format!(
            "identifier must contain 1..={MAX_ID_LENGTH} UTF-8 bytes"
        ));
    }
    Ok(())
}

fn validate_configuration(config: &HapticConfiguration) -> Result<(), String> {
    validate_id(&config.driver_session_id)?;
    if config.revision == 0 {
        return Err("configuration revision must be positive".into());
    }
    Ok(())
}

fn validate_request(request: &NativeHapticRequest) -> Result<(), String> {
    validate_id(&request.driver_session_id)?;
    validate_id(&request.interaction_id)?;
    if request.revision == 0 {
        return Err("configuration revision must be positive".into());
    }
    if !(1..=MAX_TTL_MS).contains(&request.ttl_ms) {
        return Err(format!("ttlMs must be in 1..={MAX_TTL_MS}"));
    }
    Ok(())
}

#[derive(Clone)]
pub struct HapticsPlugin {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    handle: PluginHandle<Wry>,
}

#[allow(unused_variables)]
fn init_mobile<C: serde::de::DeserializeOwned>(
    app: &AppHandle<Wry>,
    api: PluginApi<Wry, C>,
) -> Result<HapticsPlugin, String> {
    #[cfg(target_os = "android")]
    {
        let handle = api
            .register_android_plugin(PLUGIN_IDENTIFIER, "HapticsPlugin")
            .map_err(|error| error.to_string())?;
        return Ok(HapticsPlugin { handle });
    }
    #[cfg(target_os = "ios")]
    {
        let handle = api
            .register_ios_plugin(init_plugin_plethora_haptics)
            .map_err(|error| error.to_string())?;
        return Ok(HapticsPlugin { handle });
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let _ = (app, api);
        Ok(HapticsPlugin {})
    }
}

fn unsupported_capabilities() -> HapticCapabilities {
    HapticCapabilities {
        protocol_version: PROTOCOL_VERSION,
        driver: DriverKind::None,
        driver_session_id: "desktop".into(),
        configuration_revision: 0,
        hardware: HapticSupport::Unavailable,
        system_preference: SystemPreference::Unknown,
        intensity_control: IntensityControl::None,
    }
}

mod commands {
    use super::*;

    #[tauri::command]
    pub async fn get_capabilities(
        state: State<'_, HapticsPlugin>,
    ) -> Result<HapticCapabilities, String> {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        {
            let plugin = state.inner().clone();
            return tauri::async_runtime::spawn_blocking(move || {
                plugin
                    .handle
                    .run_mobile_plugin("getCapabilities", serde_json::json!({}))
                    .map_err(|error| error.to_string())
            })
            .await
            .map_err(|error| error.to_string())?;
        }
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            let _ = state;
            Ok(unsupported_capabilities())
        }
    }

    #[tauri::command]
    pub async fn configure(
        state: State<'_, HapticsPlugin>,
        config: HapticConfiguration,
    ) -> Result<ConfigureResult, String> {
        validate_configuration(&config)?;
        #[cfg(any(target_os = "android", target_os = "ios"))]
        {
            let plugin = state.inner().clone();
            return tauri::async_runtime::spawn_blocking(move || {
                plugin
                    .handle
                    .run_mobile_plugin(
                        "configure",
                        serde_json::to_value(config).map_err(|error| error.to_string())?,
                    )
                    .map_err(|error| error.to_string())
            })
            .await
            .map_err(|error| error.to_string())?;
        }
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            let _ = state;
            Err("native haptics are unavailable on this platform".into())
        }
    }

    #[tauri::command]
    pub async fn perform(
        state: State<'_, HapticsPlugin>,
        request: NativeHapticRequest,
    ) -> Result<NativeHapticResult, String> {
        validate_request(&request)?;
        #[cfg(any(target_os = "android", target_os = "ios"))]
        {
            let plugin = state.inner().clone();
            return tauri::async_runtime::spawn_blocking(move || {
                plugin
                    .handle
                    .run_mobile_plugin(
                        "perform",
                        serde_json::to_value(request).map_err(|error| error.to_string())?,
                    )
                    .map_err(|error| error.to_string())
            })
            .await
            .map_err(|error| error.to_string())?;
        }
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            let _ = state;
            Ok(NativeHapticResult {
                status: ResultStatus::Skipped,
                reason: Some(SkipReason::Unsupported),
            })
        }
    }
}

pub use commands::{configure, get_capabilities, perform};

pub fn init() -> TauriPlugin<Wry> {
    Builder::<Wry>::new("plethora-haptics")
        .setup(|app, api| {
            let plugin = init_mobile(app, api)?;
            app.manage(plugin);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_capabilities,
            commands::configure,
            commands::perform
        ])
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wire_names_are_camel_case_and_enum_values_are_stable() {
        let request = NativeHapticRequest {
            driver_session_id: "session-1".into(),
            revision: 2,
            interaction_id: "review:one:grade".into(),
            effect: HapticEffect::Completion,
            ttl_ms: 120,
        };
        let value = serde_json::to_value(&request).unwrap();
        assert_eq!(value["driverSessionId"], "session-1");
        assert_eq!(value["interactionId"], "review:one:grade");
        assert_eq!(value["effect"], "completion");
        assert_eq!(
            serde_json::from_value::<NativeHapticRequest>(value).unwrap(),
            request
        );
    }

    #[test]
    fn invalid_enum_protocol_shape_ids_and_ttl_are_rejected() {
        assert!(serde_json::from_str::<HapticEffect>("\"vibrate\"").is_err());
        assert!(serde_json::from_str::<NativeHapticRequest>(r#"{"driverSessionId":"s","revision":1,"interactionId":"i","effect":"vibrate","ttlMs":12}"#).is_err());
        let bad_id = NativeHapticRequest {
            driver_session_id: " ".into(),
            revision: 1,
            interaction_id: "i".into(),
            effect: HapticEffect::Selection,
            ttl_ms: 10,
        };
        assert!(validate_request(&bad_id).is_err());
        let too_long = NativeHapticRequest {
            driver_session_id: "s".into(),
            revision: 1,
            interaction_id: "x".repeat(129),
            effect: HapticEffect::Selection,
            ttl_ms: 10,
        };
        assert!(validate_request(&too_long).is_err());
        let bad_ttl = NativeHapticRequest {
            driver_session_id: "s".into(),
            revision: 1,
            interaction_id: "i".into(),
            effect: HapticEffect::Selection,
            ttl_ms: 151,
        };
        assert!(validate_request(&bad_ttl).is_err());
    }

    #[test]
    fn desktop_capabilities_are_explicitly_unsupported() {
        let caps = unsupported_capabilities();
        assert_eq!(caps.driver, DriverKind::None);
        assert_eq!(caps.hardware, HapticSupport::Unavailable);
        assert_eq!(caps.system_preference, SystemPreference::Unknown);
    }

    #[test]
    fn shared_bridge_fixture_matches_rust_models() {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Fixture {
            capabilities: HapticCapabilities,
            configuration: HapticConfiguration,
            request: NativeHapticRequest,
            submitted: NativeHapticResult,
            skipped: NativeHapticResult,
        }

        let fixture: Fixture =
            serde_json::from_str(include_str!("../fixtures/bridge-contract.json"))
                .expect("shared bridge fixture should deserialize");
        assert_eq!(fixture.capabilities.protocol_version, PROTOCOL_VERSION);
        assert!(fixture.configuration.enabled);
        assert_eq!(fixture.request.effect, HapticEffect::Commit);
        assert_eq!(fixture.submitted.status, ResultStatus::Submitted);
        assert_eq!(fixture.skipped.reason, Some(SkipReason::Stale));
    }
}
