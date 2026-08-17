# Change: Implement Plethora Pro Feature Discovery, Upgrade, and Paywall UX

> Wave 4 — Commercialization. Hard-depends on proposals 2 (CapabilityGate/reasons), 3 (account state), 4 (purchase flows). This change owns every **monetization-facing surface**; feature proposals own their own disabled-fallback content.

## Why

Monetization UX determines whether Pro feels like an invitation or a toll booth. The philosophy: **do not paywall reading; paywall augmentation** — every Pro surface must appear where a capability is genuinely relevant (contextual discovery), state plainly what it does and what it costs (quota/compute disclosure), never use dark patterns (no fake urgency, no confirm-shaming, no data hostage-taking — the app keeps working and local content stays accessible after cancellation, forever).

## What exists today
- `UserProfilePanel.tsx`: email, Free/Pro badge, stub "Upgrade to Pro" panel, logout. `LoginModal` for auth.
- CapabilityGate/useCapability primitives + quota meters (proposal 2, unstyled).
- Billing state (proposal 4): `billingStore`, provider abstraction, restore flows.
- Discovery precedents: onboarding tour (`components/onboarding/tour/`), command palette contextual actions, empty states throughout, `AiIndexPanel`-style progressive disclosure settings.
- i18n across 6 locales; theme system (paywall surfaces must respect all 48+ themes + e-ink).

## What Changes

### 1. Upgrade surfaces
- **Contextual upgrade points** (rendered via CapabilityGate fallbacks + the surface registry from 2): each Pro capability ships 1–2 contextual entry points — e.g. connections affordance (8), "improve this document" (16), premium voice picker (17), cloud transcription choice (18), remote inbox (19), token manager (20), RAG cloud tier (7). Fallback content = brief value statement + current reason (`signed_out` → sign-in CTA; `plan` → upgrade CTA; `quota_exhausted` → quota state + reset time; `offline`/`grace` → status note).
- **Central paywall sheet**: capability-specific content (what it does, what's cloud vs local, quota summary, price via billing products) with monthly/annual toggle where store metadata provides it, trial entry when eligible (4), and provider-appropriate purchase buttons (native stores on mobile; web checkout on desktop/web). No countdown timers, no pre-checked options, no "decline" guilts.
- **Feature catalog**: a "Plethora Pro" settings page enumerating capabilities with status (active/trial/quota/locked), what stays free (explicit, prominent — "everything local stays free, always"), and per-capability deep links.

### 2. Quota & usage UX
- Standard quota meter component (consumed/limit, window, reset date) reused by 7/16/17/18/19; pre-flight spend dialogs share one component with capability-specific estimates; `quota_exhausted` states offer: wait-for-reset explanation, local alternative when one exists, upgrade path.

### 3. Trial UX
- Trial start from paywall when store-eligible; trial state visible (days remaining in catalog + subtle capability badges); trial-end behavior: gentle notification + capability degradation to Free fallbacks with data preserved (nothing deleted — re-subscribe restores).

### 4. Subscription management
- In settings: current plan, renewal/expiry, provider-appropriate manage links (App Store/Play/web portal), restore purchases, refresh entitlements, and explicit status for grace/expired states. Cancellation flows never touch local data (copy makes this explicit; invariant tested in 3/22).

### 5. Expired / offline / downgrade behavior
- Expired: capabilities degrade to local fallbacks with reason `plan`; a single non-nagging summary (badge in settings, one post-expiry notice) — no recurring modals.
- Offline: `offline`/`grace` reasons render status, not upsells.
- Downgrade data policy: cloud artifacts retained per retention policy (22) and downloadable; local library untouched — stated in the paywall and help copy.

### 6. Discovery (non-paywall)
- Feature discovery for **Free** features too (new-user onboarding extension, palette actions, empty-state hints) — the same surface registry powers "did you know" hints with strict frequency caps (respecting calm-UX; never during reading/review).

## Impact

### Affected Specs
- `upgrade-ux` — New (surface contracts, paywall rules, quota UX, trial/expiry behavior, no-dark-pattern invariants, copy requirements).

### Affected Code Areas
- New `src/components/monetization/{PaywallSheet,QuotaMeter,SpendEstimateDialog,CapabilityCatalog,TrialBadge}.tsx`; `UserProfilePanel` upgrade panel replacement; settings sections; onboarding extension; i18n 6 locales (largest copy surface — all paywall strings); theme/e-ink pass.

### Non-goals
- No pricing decisions in code (products from billing), no A/B infra v1, no marketing site (repo-external), no changes to capability semantics (2) or purchase mechanics (4).

## Dependencies

### Hard dependencies
- 2, 3, 4. Soft: 5 (quota data), feature proposals' fallback content (7–20 land their own).

### May run concurrently
- 22 (different settings sections), 24 (no UI overlap); late-stage 23 (store screenshots need final UX).

### Must not start yet
- 23's store listing screenshots/metadata.

## Shared interfaces
- Paywall/quota component APIs (feature proposals embed `QuotaMeter`, trigger `showPaywall(capability, context)`); surface-registry conventions (2); copy source-of-truth file for capability descriptions (shared with docs).

## Ownership boundaries
- **May modify**: monetization components, `UserProfilePanel`, settings/onboarding additive sections, i18n keys under `monetization.*`.
- **Must treat as external**: CapabilityGate semantics (2), purchase flows (4), feature fallback content (each proposal), account panel structure (3 owns shell).

## Collision risks
- `UserProfilePanel.tsx` (3 owns account structure — this change replaces the upgrade stub section only); settings tab list (several proposals add tabs — append-only discipline); i18n locales (biggest merge surface; append-only + coordination via roadmap).

## Integration contract
- `showPaywall(capabilityId, context?)` global API; `QuotaMeter` consumes `QuotaState`; all surfaces render machine reasons from 2 verbatim-classified (no invented states); feature proposals call these instead of building dialogs.

## Testing & acceptance

### Tests
- Reason→surface matrix: every `CapabilityState.reason` renders the correct component class (signed-out CTA vs upgrade vs quota vs grace vs offline) — snapshot tests per state.
- No-dark-pattern lint/test: static checks for banned patterns (countdown timers, pre-checked consents, repeated-modal frequency caps, confirm-shaming phrases in locale files).
- Quota math: meter renders `QuotaState` correctly incl. reset rollover; spend estimates match pre-flight math of 5/16/17/18.
- Trial/expiry: degradation paths preserve data (integration with entitlement fixtures); single-notice caps enforced.
- Theme/e-ink: paywall renders in e-ink mode and representative themes (visual smoke).
- Copy completeness: all 6 locales carry all monetization keys (CI check pattern).

### Acceptance criteria
- Every Pro capability has a contextual, honest entry point; the paywall explains value, cost, quota, and what stays free; purchase/restore/trial/manage flows work per platform (with 4's sandbox); expired/offline/downgrade states behave with zero data loss and no nagging; Free users never see a paywall inside reading or review flows.

### Must remain unchanged
- Reading/review flows contain zero monetization surfaces (invariant test); capability semantics; existing onboarding behaviors.

## Open questions
1. Pricing display granularity (exact price strings come from store products — formatting per locale).
2. Whether annual-default toggle is allowed per store policies per platform (follow 4/23 policy verification).
3. Discovery hint frequency defaults (strict caps; product-tunable).
