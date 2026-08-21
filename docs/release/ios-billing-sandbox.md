# iOS Billing Sandbox Verification Matrix

Change: `openspec/changes/implement-native-ios-storekit2-billing` (§7.1).
Evidence runs are owned by the TestFlight evidence-gates change (G); this
document is the source matrix.

## Prerequisites

| Item | Where |
|---|---|
| StoreKit configuration file (local sandbox) | `src-tauri/plugins/plethora-storekit/ios/Configuration/PlethoraProducts.storekit` |
| Product identifiers | `plethora_pro_monthly`, `plethora_pro_annual` (`src/lib/billing/productIds.ts`) |
| Sandbox tester accounts | App Store Connect → Users and Access → Sandbox Testers |
| Server verification env | `APP_STORE_KEY_ID`, `APP_STORE_ISSUER_ID`, `APP_STORE_PRIVATE_KEY`, optional `APP_STORE_BUNDLE_ID`, `APP_STORE_ENV=sandbox` |
| Build | `npm run tauri:ios:build:device` with `PLETHORA_BUILD_PROFILE=store` (App Store profile) or development profile for simulator |

Two verification levels are required before sign-off (§7.2):

1. **Simulator verified** — Xcode scheme with the committed StoreKit
   configuration attached; no ASC credentials needed.
2. **Physical-device sandbox verified** — signed into a sandbox tester
   account on device, server reachable with sandbox ASC credentials.

## Scenario matrix

Each row: execute → record transaction id(s), observed UI state, server
`store_transactions.status`, and user tier. Pass requires every row green at
BOTH levels unless noted.

| # | Scenario | Steps | Expected behavior |
|---|---|---|---|
| 1 | Purchase monthly | Paywall → buy `plethora_pro_monthly` | Spinner → success. Localized price from StoreKit only. Entitlement refresh grants Pro. `store_transactions.status='active'`. |
| 2 | Purchase annual | Paywall → buy `plethora_pro_annual` | Same as #1 with annual period; renewal date ≈ +1 year from verified payload. |
| 3 | Cancel (auto-renew off) | Manage Subscription sheet → turn off renewal | Pro persists until expiry. At expiry: status transitions active → grace (≤72h) → expired; user downgraded to free after grace. |
| 4 | Refund / revoke | Request refund via sandbox (or `REVOKE` ASNS) | Webhook marks row `revoked`; user downgraded immediately; paywall re-arms on gated features. |
| 5 | Ask-to-buy pending | Child account purchase requiring approval | Purchase returns `pending`; paywall shows "awaiting approval". Approve in parental prompt → `Transaction.updates` fires → entitlement granted without relaunch. |
| 6 | Restore on second device | Install on device B, same Apple ID + Plethora account → Restore Purchases | Verified entitlements re-derived via `AppStore.sync()`; Pro granted; pending JWS queue flushed to server. |
| 7 | Relaunch persistence | Kill app after purchase; relaunch offline | Cached snapshot serves Pro within TTL/grace; `Transaction.currentEntitlements` confirms locally. |
| 8 | Grace (billing retry) | Simulate renewal failure (sandbox billing-retry setting or `GRACE_PERIOD` notification) | Pro retained with visible "billing issue" state during 72h window; hard downgrade after grace if recovery fails. |
| 9 | Billing recovery | After #8, let renewal succeed (`BILLING_RECOVERY`) | Status back to `active`; billing-issue banner clears. |
| 10 | Offline purchase reconciliation | Enable airplane mode, purchase, then reconnect | JWS queued client-side; next launch posts it; server verifies and grants retroactively. |
| 11 | Wrong-bundle / tampered rejection (server) | POST a forged/tampered JWS to `/v1/billing/validate` | 422 `verification_failed`; no grant; covered by automated fixture tests too. |
| 12 | Mock firewall (production build) | Launch a `PLETHORA_BUILD_PROFILE=store` build | Mock provider construction throws; paywall shows StoreKit products or retry state — never invented prices. |
| 13 | Manage subscription sheet | Settings/account → Manage Subscription | Apple's manage-subscriptions sheet opens (iOS 15+); URL fallback otherwise. |

## Recording results

For each executed row append to the evidence file owned by change G:

```
scenario: <#>
date: <iso>
build: <profile + version>
level: simulator | physical-sandbox
transactionId / originalTransactionId: <from logs>
observed: <UI state + server row status>
result: pass | fail(+notes)
```

## Known limitations at authorship

- §7.2 execution has NOT been performed (no physical device / ASC access
  available when this was implemented). Both verification levels remain open.
- The trusted-root fingerprint constant in
  `server/src/billing/jws.ts` must be confirmed against Apple's published
  root list before production sign-off (overridable via
  `APP_STORE_TRUSTED_ROOT_SHA256` meanwhile).
