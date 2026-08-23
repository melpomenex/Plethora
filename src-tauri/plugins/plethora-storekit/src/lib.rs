//! Tauri plugin for native iOS StoreKit 2 billing.
//!
//! On iOS the work is delegated to native Swift via Tauri's mobile plugin
//! IPC (see `ios/Sources/StoreKitPlugin.swift`): product query
//! (`Product.products(for:)`), purchase (`product.purchase(options:)` with
//! `.appAccountToken`), verified entitlement iteration
//! (`Transaction.currentEntitlements`), restore (`AppStore.sync()`), a
//! `Transaction.updates` listener forwarded to the frontend as the
//! `plethora-storekit-transaction-update` channel event, and Apple's
//! manage-subscriptions sheet. JWS verification semantics live on the Swift
//! side: any `VerificationResult.unverified` is a failure, never a grant.
//!
//! The authoritative entitlement path still runs through the Plethora server:
//! the frontend posts the signed JWS from `storekit_purchase` to
//! `/v1/billing/validate`, which re-verifies it against the Apple certificate
//! chain before deriving grants.
//!
//! StoreKit 2 is Apple-only: on every non-iOS target every command returns a
//! typed `UNSUPPORTED:` error so callers can branch cleanly (same pattern as
//! `install_apk`). There is no Android side for this plugin.

use serde::{de::DeserializeOwned, Deserialize, Serialize};
#[cfg(target_os = "ios")]
use tauri::plugin::PluginHandle;
use tauri::{
    plugin::{PluginApi, TauriPlugin},
    AppHandle, Manager, State, Wry,
};
use thiserror::Error;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_plethora_storekit);

/// Errors surfaced to the frontend over IPC.
#[derive(Debug, Error)]
pub enum Error {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

impl From<Error> for String {
    fn from(e: Error) -> Self {
        e.to_string()
    }
}

impl serde::Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Shared result contracts (camelCase over IPC, mirrored by the Swift payload)
// ──────────────────────────────────────────────────────────────────────────

/// One localized App Store product. Prices are ONLY ever populated from
/// StoreKit's localized `displayPrice` — no price string is authored anywhere
/// in repo code (mock-firewall invariant).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreProduct {
    pub id: String,
    pub display_name: String,
    pub description: String,
    /// Localized, formatted price straight from StoreKit (e.g. "€9,99").
    pub price_formatted: String,
    /// Normalized billing period: "monthly" | "annual" | null.
    #[serde(default)]
    pub period: Option<String>,
    /// Localized introductory-offer summary when one exists.
    #[serde(default)]
    pub intro_offer: Option<IntroOffer>,
    /// Free-trial length in days when the intro offer is a free trial.
    #[serde(default)]
    pub trial_days: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntroOffer {
    pub display_price: String,
    pub period_value: u32,
    /// "day" | "week" | "month" | "year"
    pub period_unit: String,
    /// "freeTrial" | "payAsYouGo" | "payUpFront"
    pub payment_mode: String,
}

/// Outcome of a purchase attempt.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseOutcome {
    /// "purchased" | "pending" | "userCancelled" | "failed"
    pub outcome: String,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub transaction: Option<VerifiedTransaction>,
}

/// A StoreKit-2-verified transaction. The signed JWS travels alongside the
/// decoded fields so the server can re-verify authoritatively; anything that
/// failed on-device verification never produces this struct.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifiedTransaction {
    pub original_transaction_id: String,
    pub transaction_id: String,
    pub product_id: String,
    /// Milliseconds since epoch.
    #[serde(default)]
    pub purchase_date_ms: Option<u64>,
    /// Milliseconds since epoch; absent for non-expiring purchases.
    #[serde(default)]
    pub expiration_date_ms: Option<u64>,
    /// Milliseconds since epoch; present iff refunded/revoked.
    #[serde(default)]
    pub revocation_date_ms: Option<u64>,
    #[serde(default)]
    pub revocation_reason: Option<i64>,
    /// "Production" | "Sandbox" | "Xcode"
    pub environment: String,
    /// UUID string binding this purchase to a Plethora account.
    #[serde(default)]
    pub app_account_token: Option<String>,
    /// The raw signed JWS (JWSTransaction) for server-side re-verification.
    pub jws: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub restored: bool,
    #[serde(default)]
    pub transactions: Vec<VerifiedTransaction>,
}

/// Managed plugin state. Holds the native handle on iOS; zero-sized elsewhere
/// (every command short-circuits with an UNSUPPORTED error).
#[allow(dead_code)]
#[derive(Clone)]
pub struct StoreKit {
    #[cfg(target_os = "ios")]
    handle: PluginHandle<Wry>,
}

fn unsupported(command: &str) -> Error {
    Error::Message(format!(
        "UNSUPPORTED: {command} is only supported on iOS (StoreKit 2)"
    ))
}

#[allow(unused_variables)]
fn init_mobile<C: DeserializeOwned>(
    app: &AppHandle<Wry>,
    api: PluginApi<Wry, C>,
) -> Result<StoreKit, Error> {
    #[cfg(target_os = "ios")]
    {
        let _ = app;
        let handle = api
            .register_ios_plugin(init_plugin_plethora_storekit)
            .map_err(|e| Error::Message(e.to_string()))?;
        return Ok(StoreKit { handle });
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, api);
        Ok(StoreKit {})
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Mobile invocation helper
// ──────────────────────────────────────────────────────────────────────────

#[cfg(target_os = "ios")]
fn call_mobile<T: DeserializeOwned>(state: &StoreKit, method: &str, payload: serde_json::Value) -> Result<T, Error> {
    state
        .handle
        .run_mobile_plugin::<T>(method, payload)
        .map_err(|e| Error::Message(e.to_string()))
}

// ──────────────────────────────────────────────────────────────────────────
// IPC commands — thin shims; all real logic is Swift-side
// ──────────────────────────────────────────────────────────────────────────

mod commands {
    use super::*;

    // The args/response structs are consumed only on the iOS compile path
    // (serde round-trips through the native plugin); on other targets the
    // commands short-circuit with UNSUPPORTED before touching them.
    #[allow(dead_code)]
    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct GetProductsArgs {
        #[serde(default)]
        pub ids: Option<Vec<String>>,
    }

    /// Query localized products from StoreKit. Empty-but-successful without a
    /// StoreKit configuration / App Store Connect setup.
    #[tauri::command]
    pub async fn storekit_get_products(
        state: State<'_, StoreKit>,
        ids: Option<Vec<String>>,
    ) -> Result<Vec<StoreProduct>, Error> {
        #[cfg(target_os = "ios")]
        {
            let args = GetProductsArgs { ids };
            let res: ProductList = call_mobile(
                state.inner(),
                "getProducts",
                serde_json::to_value(&args)?,
            )?;
            Ok(res.products)
        }
        #[cfg(not(target_os = "ios"))]
        {
            let _ = (state, ids);
            Err(unsupported("storekit_get_products"))
        }
    }

    #[allow(dead_code)]
    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct PurchaseArgs {
        pub product_id: String,
        #[serde(default)]
        pub app_account_token: Option<String>,
    }

    #[allow(dead_code)]
    #[derive(Debug, Deserialize)]
    struct ProductList {
        #[serde(default)]
        products: Vec<StoreProduct>,
    }

    #[allow(dead_code)]
    #[derive(Debug, Deserialize)]
    struct PurchaseResponse {
        outcome: PurchaseOutcome,
    }

    #[allow(dead_code)]
    #[derive(Debug, Deserialize)]
    struct TransactionList {
        #[serde(default)]
        transactions: Vec<VerifiedTransaction>,
    }

    /// Purchase a product, binding it to the Plethora account via
    /// `.appAccountToken`. Never throws for business outcomes — cancelled /
    /// pending / failed are structured outcomes, not errors.
    #[tauri::command]
    pub async fn storekit_purchase(
        state: State<'_, StoreKit>,
        product_id: String,
        app_account_token: Option<String>,
    ) -> Result<PurchaseOutcome, Error> {
        #[cfg(target_os = "ios")]
        {
            let args = PurchaseArgs {
                product_id,
                app_account_token,
            };
            let res: PurchaseResponse = call_mobile(
                state.inner(),
                "purchase",
                serde_json::to_value(&args)?,
            )?;
            Ok(res.outcome)
        }
        #[cfg(not(target_os = "ios"))]
        {
            let _ = (state, product_id, app_account_token);
            Err(unsupported("storekit_purchase"))
        }
    }

    /// Iterate `Transaction.currentEntitlements`, dropping any unverified
    /// entries (they are never surfaced, per the verification contract).
    #[tauri::command]
    pub async fn storekit_current_entitlements(
        state: State<'_, StoreKit>,
    ) -> Result<Vec<VerifiedTransaction>, Error> {
        #[cfg(target_os = "ios")]
        {
            let res: TransactionList =
                call_mobile(state.inner(), "currentEntitlements", serde_json::json!({}))?;
            Ok(res.transactions)
        }
        #[cfg(not(target_os = "ios"))]
        {
            let _ = state;
            Err(unsupported("storekit_current_entitlements"))
        }
    }

    /// Wrap `AppStore.sync()` and return the refreshed verified entitlements.
    #[tauri::command]
    pub async fn storekit_restore(state: State<'_, StoreKit>) -> Result<RestoreResult, Error> {
        #[cfg(target_os = "ios")]
        {
            let res: RestoreResult =
                call_mobile(state.inner(), "restore", serde_json::json!({}))?;
            Ok(res)
        }
        #[cfg(not(target_os = "ios"))]
        {
            let _ = state;
            Err(unsupported("storekit_restore"))
        }
    }

    /// Start the native `Transaction.updates` observer task. Updates are
    /// emitted to frontend-registered channels under the event name
    /// `plethora-storekit-transaction-update` (see registerListener).
    #[tauri::command]
    pub async fn storekit_start_transaction_listener(state: State<'_, StoreKit>) -> Result<(), Error> {
        #[cfg(target_os = "ios")]
        {
            let _: serde_json::Value = call_mobile(
                state.inner(),
                "startTransactionListener",
                serde_json::json!({}),
            )?;
            Ok(())
        }
        #[cfg(not(target_os = "ios"))]
        {
            let _ = state;
            Err(unsupported("storekit_start_transaction_listener"))
        }
    }

    /// Present Apple's manage-subscriptions sheet (iOS 15+) or fall back to
    /// opening the subscription-management URL.
    #[tauri::command]
    pub async fn storekit_manage_subscriptions(state: State<'_, StoreKit>) -> Result<(), Error> {
        #[cfg(target_os = "ios")]
        {
            let _: serde_json::Value = call_mobile(
                state.inner(),
                "manageSubscriptions",
                serde_json::json!({}),
            )?;
            Ok(())
        }
        #[cfg(not(target_os = "ios"))]
        {
            let _ = state;
            Err(unsupported("storekit_manage_subscriptions"))
        }
    }

    /// Read the persisted per-account appAccountToken (nil until set).
    #[tauri::command]
    pub async fn storekit_app_account_token(state: State<'_, StoreKit>) -> Result<Option<String>, Error> {
        #[cfg(target_os = "ios")]
        {
            #[derive(Deserialize)]
            struct TokenResponse {
                #[serde(default)]
                token: Option<String>,
            }
            let res: TokenResponse =
                call_mobile(state.inner(), "getAppAccountToken", serde_json::json!({}))?;
            Ok(res.token)
        }
        #[cfg(not(target_os = "ios"))]
        {
            let _ = state;
            Err(unsupported("storekit_app_account_token"))
        }
    }

    /// Persist the per-account appAccountToken (called at sign-in).
    #[tauri::command]
    pub async fn storekit_set_app_account_token(
        state: State<'_, StoreKit>,
        token: String,
    ) -> Result<(), Error> {
        #[cfg(target_os = "ios")]
        {
            let _: serde_json::Value = call_mobile(
                state.inner(),
                "setAppAccountToken",
                serde_json::json!({ "token": token }),
            )?;
            Ok(())
        }
        #[cfg(not(target_os = "ios"))]
        {
            let _ = (state, token);
            Err(unsupported("storekit_set_app_account_token"))
        }
    }
}

pub use commands::{
    storekit_app_account_token, storekit_current_entitlements, storekit_get_products,
    storekit_manage_subscriptions, storekit_purchase, storekit_restore,
    storekit_set_app_account_token, storekit_start_transaction_listener,
};

/// Initializes the plugin. The builder name MUST match the crate name
/// (`plethora-storekit`) — see the note in plethora-folder-import.
pub fn init() -> TauriPlugin<Wry> {
    tauri::plugin::Builder::<Wry>::new("plethora-storekit")
        .invoke_handler(tauri::generate_handler![
            commands::storekit_get_products,
            commands::storekit_purchase,
            commands::storekit_current_entitlements,
            commands::storekit_restore,
            commands::storekit_start_transaction_listener,
            commands::storekit_manage_subscriptions,
            commands::storekit_app_account_token,
            commands::storekit_set_app_account_token
        ])
        .setup(|app, api| {
            let storekit = init_mobile(app.app_handle(), api)?;
            app.manage(storekit);
            Ok(())
        })
        .build()
}
