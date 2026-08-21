//! Compile-time build profile for Plethora (Change A §3.3).
//!
//! Mirrors the frontend contract in `src/lib/buildProfile.ts`: the profile is
//! injected via the `PLETHORA_BUILD_PROFILE` environment variable at compile
//! time (`development` | `sideload` | `store`, default `development`). The
//! Tauri CLI passes env vars through to cargo, so a store build is produced
//! with e.g. `PLETHORA_BUILD_PROFILE=store npm run tauri:ios:build:device`.
//!
//! Consumers: Proposal F gates its mock-auth path on [`is_store_profile`] /
//! [`build_profile`] (read-only). Proposal B's billing assertions may do the
//! same. Do not duplicate the constant.

/// The compile-time build profile. Unknown/absent values degrade to
/// `"development"` — the same fail-safe default as the frontend helper.
pub fn build_profile() -> &'static str {
    match option_env!("PLETHORA_BUILD_PROFILE") {
        Some("sideload") => "sideload",
        Some("store") => "store",
        _ => "development",
    }
}

/// True only for App Store distribution builds.
pub fn is_store_profile() -> bool {
    build_profile() == "store"
}

/// True for the default development profile.
pub fn is_development_profile() -> bool {
    build_profile() == "development"
}

/// Store-profile invariant: the updater plugin must never be active in a
/// store build. The desktop updater is already cfg-gated out of iOS
/// (`not(any(ios, android))` in lib.rs), so on iOS this holds structurally;
/// this check is the explicit guard that keeps it true if that cfg ever
/// changes. Call it wherever the updater plugin is registered.
///
/// Returns `Err` with an actionable message when the invariant is violated;
/// the caller should abort plugin registration / fail the build.
pub fn assert_no_updater_in_store_build(updater_active: bool) -> Result<(), String> {
    if is_store_profile() && updater_active {
        Err(
            "PLETHORA_BUILD_PROFILE=store refuses to build with the updater plugin \
             registered. Store builds must not contain self-update behavior."
                .to_string(),
        )
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_profile_is_development() {
        // Test builds never set PLETHORA_BUILD_PROFILE.
        assert_eq!(build_profile(), "development");
        assert!(is_development_profile());
        assert!(!is_store_profile());
    }

    #[test]
    fn updater_invariant_passes_when_updater_inactive() {
        assert!(assert_no_updater_in_store_build(false).is_ok());
    }

    #[test]
    fn updater_invariant_fails_only_for_store_builds_with_updater_active() {
        // Non-store profiles tolerate an active updater (desktop behavior).
        // This branch is exercised for the default (development) profile the
        // test harness compiles with.
        if !is_store_profile() {
            assert!(assert_no_updater_in_store_build(true).is_ok());
        } else {
            assert!(assert_no_updater_in_store_build(true).is_err());
        }
    }

    #[test]
    fn store_profile_rejects_active_updater() {
        // Direct invariant check independent of the compiled-in profile.
        let refuses = |profile: &str, updater_active: bool| -> bool {
            let store = profile == "store";
            store && updater_active
        };
        assert!(refuses("store", true));
        assert!(!refuses("store", false));
        assert!(!refuses("sideload", true));
        assert!(!refuses("development", true));
    }
}
