use crate::build_profile;
use once_cell::sync::OnceCell;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use tauri::{AppHandle, Emitter};

mod cloud;
mod refresh;
mod token;
pub use cloud::AuthSessionJson;
pub use refresh::{refresh_access_token, RefreshError};

static APP_HANDLE: OnceCell<AppHandle> = OnceCell::new();

pub fn init(app: AppHandle) {
    let _ = APP_HANDLE.set(app);
}

/// Change F §2.2 — the fabricated mock sign-in must never exist in store
/// (App Store distribution) builds. Development and sideload builds keep it,
/// with credentials explicitly labeled `dev-mock-*`. Real credential
/// transport (HTTP + refresh) is owned by Proposal B; until then the
/// frontend signs in against the real Plethora API and owns session state,
/// while this module only mirrors state for native callers.
pub fn mock_sign_in_allowed(profile: &str) -> bool {
    profile != "store"
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UserProfile {
    pub id: String,
    pub email: String,
    pub subscription_tier: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeviceInfo {
    pub id: String,
    pub device_name: String,
    pub platform: String,
    pub public_key: Option<String>,
    pub created_at: String,
    pub last_seen: String,
    pub revoked_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AccountTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AccountState {
    pub is_signed_in: bool,
    pub user: Option<UserProfile>,
    pub device_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RotatedTokensEvent {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: u64,
}

#[derive(Debug, Clone)]
pub struct AuthManager {
    state: Arc<RwLock<AccountState>>,
    tokens: Arc<RwLock<Option<AccountTokens>>>,
    devices: Arc<RwLock<Vec<DeviceInfo>>>,
    refresh_lock: Arc<tokio::sync::Mutex<()>>,
}

impl Default for AuthManager {
    fn default() -> Self {
        Self::new()
    }
}

impl AuthManager {
    pub fn new() -> Self {
        Self {
            state: Arc::new(RwLock::new(AccountState {
                is_signed_in: false,
                user: None,
                device_id: None,
            })),
            tokens: Arc::new(RwLock::new(None)),
            devices: Arc::new(RwLock::new(Vec::new())),
            refresh_lock: Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    pub fn get_state(&self) -> AccountState {
        self.state.read().unwrap().clone()
    }

    pub fn set_signed_in(
        &self,
        user: UserProfile,
        tokens: AccountTokens,
        device_id: Option<String>,
    ) {
        if let Ok(mut lock) = self.state.write() {
            lock.is_signed_in = true;
            lock.user = Some(user);
            lock.device_id = device_id;
        }
        if let Ok(mut lock) = self.tokens.write() {
            *lock = Some(tokens);
        }
    }

    /// Mirror a browser/API login session into native auth state for sync transport.
    pub fn sync_session(
        &self,
        user: UserProfile,
        tokens: AccountTokens,
        device_id: Option<String>,
    ) {
        self.set_signed_in(user, tokens, device_id);
    }

    pub fn set_signed_out(&self) {
        if let Ok(mut lock) = self.state.write() {
            lock.is_signed_in = false;
            lock.user = None;
            lock.device_id = None;
        }
        if let Ok(mut lock) = self.tokens.write() {
            *lock = None;
        }
        if let Ok(mut lock) = self.devices.write() {
            lock.clear();
        }
    }

    pub fn get_access_token(&self) -> Option<String> {
        self.tokens
            .read()
            .ok()
            .and_then(|t| t.as_ref().map(|tok| tok.access_token.clone()))
    }

    pub fn get_refresh_token(&self) -> Option<String> {
        self.tokens
            .read()
            .ok()
            .and_then(|t| t.as_ref().map(|tok| tok.refresh_token.clone()))
    }

    pub fn update_tokens(&self, tokens: AccountTokens) {
        if let Ok(mut lock) = self.tokens.write() {
            *lock = Some(tokens);
        }
    }

    fn emit_tokens_rotated(&self, tokens: &AccountTokens) {
        let Some(app) = APP_HANDLE.get() else {
            return;
        };
        let _ = app.emit(
            "plethora-auth-tokens-rotated",
            RotatedTokensEvent {
                access_token: tokens.access_token.clone(),
                refresh_token: tokens.refresh_token.clone(),
                expires_in: tokens.expires_in,
            },
        );
    }

    fn emit_session_revoked(&self) {
        let Some(app) = APP_HANDLE.get() else {
            return;
        };
        let _ = app.emit("plethora-auth-session-revoked", ());
    }

    /// Rotate the access token when it is missing, undecodable, or near expiry.
    pub async fn ensure_fresh_access_token(&self) -> Result<String, RefreshError> {
        let needs_refresh = self
            .get_access_token()
            .map(|token| refresh::should_refresh_access_token(&token))
            .unwrap_or(true);
        if needs_refresh {
            self.refresh_tokens().await?;
        }
        self.get_access_token()
            .ok_or(RefreshError::NoRefreshToken)
    }

    /// Force a refresh even when the current access token still looks fresh.
    pub async fn force_refresh_tokens(&self) -> Result<(), RefreshError> {
        self.do_refresh(true).await
    }

    /// Single-flight refresh: concurrent callers share one network round-trip.
    pub async fn refresh_tokens(&self) -> Result<(), RefreshError> {
        self.do_refresh(false).await
    }

    async fn do_refresh(&self, force: bool) -> Result<(), RefreshError> {
        let _guard = self.refresh_lock.lock().await;

        if !force {
            if let Some(access) = self.get_access_token() {
                if !refresh::should_refresh_access_token(&access) {
                    return Ok(());
                }
            }
        }

        let refresh_token = self.get_refresh_token().ok_or(RefreshError::NoRefreshToken)?;
        let response = refresh_access_token(&refresh_token).await?;
        let rotated = refresh::tokens_from_refresh(response);
        self.update_tokens(rotated.clone());
        self.emit_tokens_rotated(&rotated);
        Ok(())
    }

    pub fn handle_refresh_failure(&self, error: RefreshError) {
        if matches!(
            error,
            RefreshError::SessionRevoked | RefreshError::TokenExpired
        ) {
            self.set_signed_out();
            self.emit_session_revoked();
        }
    }

    pub fn get_user_id(&self) -> Option<String> {
        self.state
            .read()
            .ok()
            .and_then(|state| state.user.as_ref().map(|user| user.id.clone()))
    }

    /// The device identity the account issued for this session. Sync records
    /// must be stamped with it so the server can attribute them to this
    /// device; `None` for sessions that predate device issuance.
    pub fn get_device_id(&self) -> Option<String> {
        self.state
            .read()
            .ok()
            .and_then(|state| state.device_id.clone())
            .filter(|id| !id.trim().is_empty())
    }

    pub fn set_devices(&self, devices: Vec<DeviceInfo>) {
        if let Ok(mut lock) = self.devices.write() {
            *lock = devices;
        }
    }

    pub fn get_devices(&self) -> Vec<DeviceInfo> {
        self.devices.read().unwrap().clone()
    }

    pub fn revoke_device(&self, device_id: &str) {
        if let Ok(mut lock) = self.devices.write() {
            for dev in lock.iter_mut() {
                if dev.id == device_id {
                    dev.revoked_at = Some(chrono::Utc::now().to_rfc3339());
                }
            }
        }
    }
}

// -----------------------------------------------------------------------------
// Tauri Commands
// -----------------------------------------------------------------------------

#[tauri::command]
pub fn account_get_state(auth: tauri::State<Arc<AuthManager>>) -> Result<AccountState, String> {
    Ok(auth.get_state())
}

#[tauri::command]
pub fn account_sign_in(
    auth: tauri::State<Arc<AuthManager>>,
    email: String,
    password: String,
    device_name: Option<String>,
) -> Result<AccountState, String> {
    // Store builds: never fabricate a session. The frontend performs the real
    // login against the Plethora API; this command is a state-preserving
    // no-op mirror until Proposal B lands the native transport.
    if !mock_sign_in_allowed(build_profile::build_profile()) {
        return Ok(auth.get_state());
    }

    // DEVELOPMENT/SIDELOAD ONLY: fabricate a clearly-labeled mock session so
    // dev and simulator runs work without a configured backend. Tokens here
    // are NOT real credentials.
    let _ = (&password, &device_name);
    let user = UserProfile {
        id: "dev-mock-user-uuid".to_string(),
        email: email.clone(),
        subscription_tier: "free".to_string(),
    };
    let tokens = AccountTokens {
        access_token: "dev-mock-access-jwt".to_string(),
        refresh_token: "dev-mock-refresh-token".to_string(),
        expires_in: 900,
    };
    let device_id = Some("dev-mock-device-uuid".to_string());

    auth.set_signed_in(user, tokens, device_id);
    Ok(auth.get_state())
}

#[tauri::command]
pub async fn account_auth_register(
    email: String,
    password: String,
    device_name: Option<String>,
    platform: Option<String>,
) -> Result<AuthSessionJson, String> {
    cloud::register_account(email, password, device_name, platform).await
}

#[tauri::command]
pub async fn account_auth_login(
    email: String,
    password: String,
    device_id: Option<String>,
    device_name: Option<String>,
    platform: Option<String>,
) -> Result<AuthSessionJson, String> {
    cloud::login_account(email, password, device_id, device_name, platform).await
}

#[tauri::command]
pub fn account_sync_session(
    auth: tauri::State<Arc<AuthManager>>,
    user: UserProfile,
    tokens: AccountTokens,
    device_id: Option<String>,
) -> Result<AccountState, String> {
    auth.sync_session(user, tokens, device_id);
    Ok(auth.get_state())
}

#[tauri::command]
pub fn account_sign_out(
    auth: tauri::State<Arc<AuthManager>>,
    entitlements: tauri::State<Arc<crate::entitlements::EntitlementCache>>,
    _local_only: bool,
) -> Result<AccountState, String> {
    auth.set_signed_out();
    // The active entitlement snapshot belongs to the session being left:
    // clear it so a logged-out process resolves anonymous Free defaults.
    // Persisted per-account snapshots stay on disk (keyed, inactive) for a
    // future sign-in of that account.
    entitlements.clear_cached_snapshot();
    Ok(auth.get_state())
}

#[tauri::command]
pub async fn account_refresh(auth: tauri::State<'_, Arc<AuthManager>>) -> Result<AccountState, String> {
    match auth.refresh_tokens().await {
        Ok(()) => Ok(auth.get_state()),
        Err(error) => {
            auth.handle_refresh_failure(error.clone());
            Err(error.to_string())
        }
    }
}

#[tauri::command]
pub fn account_list_devices(
    auth: tauri::State<Arc<AuthManager>>,
) -> Result<Vec<DeviceInfo>, String> {
    Ok(auth.get_devices())
}

#[tauri::command]
pub fn account_revoke_device(
    auth: tauri::State<Arc<AuthManager>>,
    device_id: String,
) -> Result<Vec<DeviceInfo>, String> {
    auth.revoke_device(&device_id);
    Ok(auth.get_devices())
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    #[test]
    fn mock_sign_in_is_refused_only_for_store_profile() {
        assert!(!mock_sign_in_allowed("store"));
        assert!(mock_sign_in_allowed("development"));
        assert!(mock_sign_in_allowed("sideload"));
    }

    #[test]
    fn any_non_store_profile_allows_mock() {
        // Unknown values degrade to development semantics at the build-profile
        // layer, so anything except the exact "store" profile allows mock.
        assert!(mock_sign_in_allowed(""));
        assert!(mock_sign_in_allowed("STORE")); // exact match only
    }

    #[test]
    fn test_build_profile_defaults_to_development_in_test_harness() {
        // Test builds never set PLETHORA_BUILD_PROFILE.
        assert_eq!(build_profile::build_profile(), "development");
        assert!(mock_sign_in_allowed(build_profile::build_profile()));
    }

    #[test]
    fn test_auth_manager_initial_state_is_signed_out() {
        let auth = AuthManager::new();
        let state = auth.get_state();
        assert!(!state.is_signed_in);
        assert!(state.user.is_none());
        assert!(state.device_id.is_none());
        assert!(auth.get_access_token().is_none());
    }

    #[test]
    fn test_auth_manager_sign_in_and_sign_out() {
        let auth = AuthManager::new();
        let user = UserProfile {
            id: "u-1".to_string(),
            email: "alice@example.com".to_string(),
            subscription_tier: "pro".to_string(),
        };
        let tokens = AccountTokens {
            access_token: "jwt-1".to_string(),
            refresh_token: "ref-1".to_string(),
            expires_in: 900,
        };
        auth.set_signed_in(user.clone(), tokens, Some("dev-1".to_string()));

        let state = auth.get_state();
        assert!(state.is_signed_in);
        assert_eq!(state.user.unwrap().email, "alice@example.com");
        assert_eq!(auth.get_access_token().unwrap(), "jwt-1");

        auth.set_signed_out();
        let out_state = auth.get_state();
        assert!(!out_state.is_signed_in);
        assert!(out_state.user.is_none());
        assert!(auth.get_access_token().is_none());
    }

    #[test]
    fn test_device_revocation() {
        let auth = AuthManager::new();
        let dev1 = DeviceInfo {
            id: "d1".to_string(),
            device_name: "MacBook Pro".to_string(),
            platform: "macos".to_string(),
            public_key: None,
            created_at: "2026-08-17T00:00:00Z".to_string(),
            last_seen: "2026-08-17T00:00:00Z".to_string(),
            revoked_at: None,
        };
        auth.set_devices(vec![dev1]);
        assert_eq!(auth.get_devices().len(), 1);
        assert!(auth.get_devices()[0].revoked_at.is_none());

        auth.revoke_device("d1");
        assert!(auth.get_devices()[0].revoked_at.is_some());
    }

    #[tokio::test]
    async fn refresh_tokens_rotates_stale_access_token() {
        let auth = AuthManager::new();
        let exp = chrono::Utc::now().timestamp() - 60;
        let header = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(r#"{"alg":"none","typ":"JWT"}"#);
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(format!(r#"{{"exp":{exp}}}"#));
        let expired = format!("{header}.{payload}.sig");

        auth.set_signed_in(
            UserProfile {
                id: "u-1".to_string(),
                email: "alice@example.com".to_string(),
                subscription_tier: "pro".to_string(),
            },
            AccountTokens {
                access_token: expired,
                refresh_token: "refresh-1".to_string(),
                expires_in: 900,
            },
            Some("dev-1".to_string()),
        );

        let body = r#"{"accessToken":"access-2","refreshToken":"refresh-2","expiresIn":900}"#;
        let response: &'static [u8] = Box::leak(
            format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .into_boxed_str()
            .into_boxed_bytes(),
        );
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            use std::io::{Read, Write};
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = [0u8; 4096];
            let _ = stream.read(&mut buf);
            stream.write_all(response).unwrap();
        });
        std::env::set_var("PLETHORA_API_URL", format!("http://{addr}"));

        auth.refresh_tokens().await.expect("refresh should succeed");
        assert_eq!(auth.get_access_token().as_deref(), Some("access-2"));
        assert_eq!(auth.get_refresh_token().as_deref(), Some("refresh-2"));
    }
}
