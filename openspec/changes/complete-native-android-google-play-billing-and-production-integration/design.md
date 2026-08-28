# Design: Android Google Play Billing and Production Integration

## Architecture

```text
PaywallModal → billingStore → PlayBillingProvider
                                    ↓ invoke
                            plethora-playbilling (Kotlin BillingClient 7.1.1)
                                    ↓ purchaseToken
                            POST /v1/billing/validate (auth required)
                                    ↓
                            Google Publisher subscriptionsv2.get
                                    ↓
                            acknowledge (server) + upsert store_transactions
                                    ↓
                            GET /v1/entitlements → Pro UI
```

## Google APIs

| Component | Version/API |
|-----------|-------------|
| Play Billing Library | 7.1.1 |
| Verification | `purchases.subscriptionsv2.get` |
| Acknowledgement | `purchases.subscriptions.acknowledge` (server-side, post-verify) |
| RTDN | Pub/Sub push → re-query Google |

## Product model

- Subscription product IDs: `plethora_pro_monthly`, `plethora_pro_annual`
- Launch focus: monthly (`plethora_pro_monthly`); annual available but optional in Play Console
- Base plan/offers configured in Play Console; client queries first offer token
- Prices: localized from `ProductDetails.subscriptionOfferDetails`

## Purchase state handling

| Google state | Client UI | Server entitlement |
|--------------|-----------|-------------------|
| PENDING | Pending message, no Pro | `free` / `pending` |
| PURCHASED | Validating… | Pro after verify |
| USER_CANCELED | Cancelled | unchanged |

## Acknowledgement

Server calls acknowledge when `acknowledgementState === ACKNOWLEDGEMENT_STATE_PENDING` after successful verify + bind. Idempotent on retry. Client does not acknowledge.

## Account binding

- Require Plethora sign-in before purchase
- Client: SHA-256(userId) as `obfuscatedAccountId` in BillingFlowParams
- Server: bind `user_id` on first `/validate`; 409 if token bound to another user

## Production API URL

- Contract in `src/config/apiUrl.ts`
- Default: `https://api.useplethora.com`
- Store builds fail Vite if URL ≠ production host

## CORS

Android Tauri WebView sends `https://tauri.localhost` or `tauri://localhost`. Production `CORS_ORIGINS` must include these plus `https://useplethora.com`.

## Release gates

- `PLETHORA_BUILD_PROFILE=store` + `VITE_PLETHORA_API_URL=https://api.useplethora.com`
- AAB via `npm run tauri:android:build:store:aab`
- Release keystore required (no silent debug fallback for store script)

## RTDN

Existing endpoint `POST /v1/billing/webhooks/playstore`. Dedupe before effects; validate package name; re-query Google.
