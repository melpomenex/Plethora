# Proposal: Complete Native Android Google Play Billing and Production Integration

## Why

Plethora production cloud (`https://api.useplethora.com`) is live with server-side Play verification and RTDN, but Android store builds cannot sell Pro: the native `plethora-playbilling` plugin was never implemented, purchase acknowledgement is missing, and production Android builds still default to the obsolete `api.plethora.app` domain.

## Scope

**In scope:** Android Google Play Billing Library integration, server acknowledgement and binding hardening, production API URL contract, Play AAB release gates, CORS for Tauri WebView, Play Console runbook.

**Out of scope:** Apple StoreKit, Stripe, infrastructure redeployment.

## Current state (HEAD audit)

| Area | Status |
|------|--------|
| Server Play verify + RTDN | Implemented; acknowledgement missing |
| Client PlayBillingProvider | Stub only |
| Native plethora-playbilling | Missing |
| Product IDs | `plethora_pro_monthly`, `plethora_pro_annual` (monthly primary for launch) |
| Production API in app | Defaults to `api.plethora.app` (wrong) |
| Android CI store profile | Not wired |
| Play AAB pipeline | APK only |

## Google APIs chosen

- **Play Billing Library:** `7.1.1` (stable; ProductDetails/subscriptions v2; widely compatible with targetSdk 36)
- **Verification:** Android Publisher `purchases.subscriptionsv2.get`
- **Acknowledgement:** Server-side `purchases.subscriptions.acknowledge` after successful verify (Google recommends backend acknowledgement)
- **RTDN:** Pub/Sub push with JWT audience verification; re-query Google for authoritative state

## Security model (adversarial review incorporated)

- Server is sole entitlement authority; client PURCHASED ≠ Pro until `/v1/billing/validate` succeeds
- PENDING purchases never grant Pro
- Purchase tokens bound to first authenticated Plethora account with obfuscated account ID
- Cross-account token claim returns 409
- Product ID and package name server-allowlisted
- Purchase tokens hashed at rest; not logged
- RTDN dedupe before side effects

## Acceptance criteria

1. Native plugin registered and used on Android store builds
2. Localized Play prices in paywall (no hardcoded prices)
3. Purchase → server verify → acknowledge → entitlement refresh
4. Pending purchases show pending UI, no Pro
5. Restore reconciles Play purchases with server
6. Store builds use `https://api.useplethora.com` exclusively
7. Play AAB builds with release signing gate
8. No `REQUEST_INSTALL_PACKAGES` in store manifest
9. Automated tests pass

## Manual (Play Console)

Documented in `docs/play-console-internal-testing-runbook.md` — app creation, subscriptions, service account, RTDN, Internal Testing upload.
