## Context

### Detection utilities (verified)

`src/lib/tauri.ts` is the single detection source: `isTauri()` (true on desktop AND mobile native), `getPlatform()` (desktop OS only), `nativePlatform()` (via `__TAURI_OS_PLUGIN_INTERNALS__`: 'android' | 'ios' | … | null), `isNativeMobile()`, `getFormFactor()`, plus reactive `useFormFactor`/`useMobileShell`. **No `isIOS()` helper exists**; iOS is detected ad hoc via UA regexes (`pwa.ts:299`, `MobileNavigation.tsx:254`) or `nativePlatform() === 'ios'` (`onDeviceAI.ts:128-131`, `captureClient.ts:191`, `storeReleaseReadiness.ts`).

### Navigation (verified)

`MobileNavigation.tsx`: static module-level `primaryNavItems` (dashboard, queue, review, documents, settings) at line 85 and `allNavItems` (adds extracts, image-registry, doc-qa, rss, newsletter, analytics, podcast, audiobook, knowledge-sphere) at line 139. `NavItem` carries `tabType`/`tabContent` from `TabRegistry.tsx` (lazy map, e.g. notebooklm at line 112). No platform field anywhere.

### Verified iOS leaks

| Surface | File:line (approx) | Problem |
|---|---|---|
| Android TTS card on iOS | `TTSSettings.tsx:927-934` | `android` adapter shown iff `isNativeMobile()` — passes on iOS; bridge `api/tts/android/bridge.ts` is Android-only |
| Updater row on iOS | `SettingsPage.tsx:1055` (`isDesktop = isTauri()`) | self-update surface inside iOS webview; `updateChecker.ts:327` uses the correct idiom |
| Screenshot import source | `EnhancedFilePicker.tsx:63,175` | ungated; `screenshotCapture.ts:78` early-returns on mobile; `captureClient.ts:190-205` already encodes an ios matrix (`native:false, iframe:false`) |
| Extension server controls | `IntegrationSettings.tsx:105-325` | browser-extension connection UI renders in iOS Tauri webview |
| NotebookLM CLI | `NotebookLMWorkspace.tsx:144`, `Toolbar.tsx:809-814`, `TabRegistry.tsx:112` | depends on external `notebooklm-py` CLI; no platform gate |
| Correct patterns to copy | `OnDeviceAiPanel.tsx` (early-return null off-platform), `AudioTranscriptionSettings.tsx:74-78` (correct desktop idiom), `storeReleaseReadiness.ts:26` (`selfUpdaterDisabled = isStoreBuild \|\| platform === 'ios'`) | advisory only, not enforced |

### Scale of the problem

Whole-word counts in src/ (excluding tests): `platform ===` ≈25, `isAndroid` 65, `isIOS` ~23, `isNativeMobile()` 67. Clusters: `api/tts/android/bridge.ts` (15), `useTTS.ts` (12), `PWAComponents.tsx` (12), `NotificationSettings.tsx` (11), `ReaderTTSControls.tsx` (10).

### Precedents

- Billing capability registry: `src/types/entitlements.ts` — `CAPABILITY_IDS`, `{ enabled, reason }`, `useCapability`, `CapabilityGate` — verified working; the natural shape to mirror for platform capabilities (reason `'unsupported_platform'`).
- `docs/product/features/platform/android-capabilities.md` exists and is wired into the help index; no iOS equivalent.

## Goals / Non-Goals

**Goals:**

- One registry answering "is <feature> available on <platform>, and why not?" for every user-visible destination/command/setting.
- iOS matrix complete and test-enforced; desktop/Android behavior byte-identical to today.
- Zero broken buttons/dead surfaces on iOS; hidden-vs-unavailable chosen deliberately per feature.
- Core workflow (Import → Read → Extract → Remember → Review) explicitly protected.

**Non-Goals:**

- Removing or degrading any desktop/Android feature.
- Rewriting all ~180 checks (migrate the risky ones; registry adoption is incremental).
- Deciding billing/privacy/share surfaces (B/C/E own those; D reserves slots).
- New product features.

## Decisions

### 1. Registry shape
`src/lib/platformCapabilities.ts`: `PlatformCapabilityId` union + `PLATFORM_CAPABILITY_REGISTRY: Record<id, { platforms: Partial<Record<Platform, Availability>>, … }>` where `Availability = { available: true } | { available: false; reason: 'unsupported_platform' | 'requires_network' | 'launch_deferred' | 'experimental'; explanationKey?: i18nKey }`. Hook `usePlatformCapability(id)` mirrors `useCapability`. Store-build assertions consume A's build profile (e.g., `apk_install` unavailable on ALL platforms under store profile).

### 2. Classification audit drives the registry
Task 1 is a full audit of every nav destination, toolbar action, command-palette entry, settings section, and import source on iOS, classified as: fully supported / supported-with-different-implementation / requires-network / temporarily-unavailable / android-only / desktop-only / experimental-hidden / launch-deferred. Expected classifications from verified evidence: Gemini Nano panel → android-only (already correct); Android TTS → android-only; Pocket TTS/local STT sidecars → desktop-only (already gated correctly); screenshot capture → desktop-only; NotebookLM → desktop-only; extension server → desktop-only; updater → hidden on iOS; APK install → android-only + forbidden in store profile; cloud TTS/AI/transcription → requires-network but supported; RSS/podcast/audiobooks → supported (verify each on iOS); knowledge sphere → supported (verify perf).

### 3. Hidden vs marked-unavailable rule
Hide when the feature adds no value and its absence is not confusing (desktop-only mechanics like extension server). Mark unavailable with a one-line explanation when discoverability matters (e.g., a queue item type that can't play). No silent dead buttons; no desktop terminology ("APK", "sidecar", "CLI") on iOS.

### 4. Nav/tab platform field
Extend `NavItem` with optional `platforms?: Platform[]` / capability id; `MobileNavigation` and `TabRegistry` filter through the registry. Desktop tab shell untouched.

### 5. Matrix doc + tests
Generate `docs/product/features/platform/ios-capabilities.md` from the registry (mirroring the android doc), with a test asserting registry↔doc consistency and a "protected surface" test asserting the five core-workflow capabilities are `available` on iOS and phone form factor.

## Data Flows

None (pure presentation layer). Registry reads `nativePlatform()`, form factor, and build profile.

## Failure Behavior

- Unknown capability id queried → dev-mode console error + fail-closed (unavailable) in production, with the id logged.
- Registry entry missing for a nav item → treated as available on all platforms (preserves current behavior) but flagged by a lint-style test listing ungated nav items.

## UX States

For marked-unavailable: disabled row/menu item with short reason string (i18n'd), tappable for explanation on mobile. For hidden: absent from nav, palette, settings; deep-links to hidden surfaces land on a sensible nearest surface, not an error.

## Testing Strategy

- Unit: registry classification snapshots; `usePlatformCapability` logic.
- Component: iOS-simulated render of navigation (no android/desktop-only items), settings sections (no updater row, no android TTS card, no extension controls, no NotebookLM), import picker (no screenshot source).
- Protected-surface test: core workflow items available.
- Regression: desktop + Android snapshots unchanged.
- Manual: full iOS surface walkthrough recorded as evidence (G consumes).

## Rollout

Registry + audit doc first (no behavior change), then per-surface migrations as small PRs, then nav filtering, then matrix generation. Each step independently revertable.

## Alternatives Considered

- Fixing only the six verified leaks without a registry: rejected — the leak class recurs with every new feature; the audit + registry is the systemic fix.
- Reusing the billing entitlement system for platform gating: rejected — different axis (plan vs platform), conflating them breaks both reason models.

## Rejected Alternatives / Notes

- A build-time stripped iOS bundle (compile-out desktop features): rejected for v1 — runtime gating is sufficient and keeps one bundle; revisit only if App Review objects to inert code paths.

## Ownership & Collision Boundaries

| File/area | Owner | Notes |
|---|---|---|
| `src/lib/platformCapabilities.ts`, `usePlatformCapability` | **D** | B/C/E/F register capability ids here via agreed enum additions only |
| `MobileNavigation.tsx`, `TabRegistry.tsx` | **D exclusively** | E/F add no tabs without D's field |
| Settings sections: general/update, TTS adapter list, integrations, import picker | **D** | C owns privacy tab content; B owns paywall internals; F owns account section content — D gates only visibility |
| `docs/product/features/platform/ios-capabilities.md` | **D** | H consumes for screenshots/reviewer notes |
| Command palettes | **D** | — |

**Shared-file merge rule:** `SettingsPage.tsx` is touched by C (privacy tab) and D (update row + section gating). Edits confined to disjoint sections; last-merge rebases; no section renumbering.
