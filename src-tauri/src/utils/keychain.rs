//! OS keychain gating.
//!
//! The macOS/Windows/Linux keychain is **opt-in**. When disabled (the default),
//! the app never touches the OS keychain — it stores secrets in an
//! encrypted-on-disk fallback instead (see `ai_key_store.rs`,
//! `cloud::auth_store.rs`). This avoids the OS keychain unlock prompt that
//! blocks app startup for users who never configured a keychain password.
//!
//! Enable by setting the `INCREMENTUM_USE_KEYCHAIN=1` environment variable
//! before launching the app.
//!
//! All keychain access in the codebase MUST go through [`keychain_enabled`]
//! rather than reading the env var directly, so the gating stays consistent.

/// Returns `true` only when the user has explicitly opted into OS keychain use
/// via `INCREMENTUM_USE_KEYCHAIN=1`. Defaults to `false`.
pub fn keychain_enabled() -> bool {
    std::env::var("INCREMENTUM_USE_KEYCHAIN").as_deref() == Ok("1")
}
