# Apple Sandbox E2E Checklist

Server-side StoreKit verification is covered by automated tests (`server/src/__tests__/storekitVerification.test.ts`). This checklist is for **physical device** validation before App Store release.

## Prerequisites

- Plethora Cloud deployed (staging or production) with `APP_STORE_*` credentials
- ASNS v2 webhook registered: `https://api.<domain>/v1/billing/webhooks/appstore`
- iOS build with `plethora-storekit` plugin and **Sandbox** Apple ID on device

## Test matrix

| Step | Action | Expected |
|------|--------|----------|
| 1 | Sign in to Plethora account on device | Account created; JWT issued |
| 2 | Purchase Pro monthly (sandbox) | StoreKit sheet completes |
| 3 | Observe client → `POST /v1/billing/validate` | `200`, `subscriptionTier: pro` |
| 4 | `GET /v1/billing/subscriptions` | Verified transaction listed |
| 5 | Force-quit app, reopen | Entitlements still `pro` (restore path) |
| 6 | `POST /v1/billing/restore` | `restored: true` |
| 7 | Cancel subscription in Sandbox settings | ASNS notification received |
| 8 | Wait for webhook processing | Tier downgrades after expiry/grace |

## Server verification (no device)

```bash
cd server && npm test -- storekitVerification
```

## Sandbox environment

Set `APP_STORE_ENV=sandbox` on staging if you want to restrict JWS to Sandbox only during pre-release testing.

## Sign-off

Record device model, iOS version, build number, and sandbox tester Apple ID in your release notes before promoting to production ASNS.
