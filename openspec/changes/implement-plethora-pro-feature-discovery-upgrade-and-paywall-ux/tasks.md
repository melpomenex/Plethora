# Implementation Tasks

## 1. Components
- [x] 1.1 `PaywallSheet` (capability-specific content, monthly/annual, trial entry, provider-agnostic CTAs via billingStore)
- [x] 1.2 `QuotaMeter` + `SpendEstimateDialog` (shared; consumed by 7/16/17/18/19)
- [x] 1.3 `CapabilityCatalog` settings page (status per capability + "always free" section) + `TrialBadge`
- [x] 1.4 `showPaywall(capability, context)` global API + surface-registry conventions

## 2. Reason matrix & states
- [x] 2.1 Reason→CTA rendering for all entitlement reasons (snapshot tests per state)
- [x] 2.2 Expired/offline/grace/downgrade states: single-notice caps, status-not-upsell, data-preservation copy + integration tests
- [x] 2.3 Subscription management section (plan, renewal, manage links, restore, refresh)

## 3. Discovery & invariants
- [x] 3.1 Onboarding extension + palette/empty-state hints with strict frequency caps (Free features too)
- [x] 3.2 No-dark-pattern automated scan (components + 6 locale files); reader/review monetization-free invariant test
- [x] 3.3 Theme + e-ink pass; mobile sheet layouts

## 4. Validation
- [x] 4.1 Copy completeness CI check (all locales carry all monetization keys)
- [x] 4.2 E2E with billing mock provider: trial→expiry→restore→manage paths
- [x] 4.3 Full gates; i18n review for the largest copy surface

