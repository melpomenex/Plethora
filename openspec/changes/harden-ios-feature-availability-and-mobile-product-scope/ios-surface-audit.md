# iOS Surface Audit — working document (Task 1.1, Change D)

Date: 2026-08-21. Classification per design §2. Every user-visible surface
class gets an entry here; registry ids in parentheses. Verified against live
code on `main` (post A/C/E landing).

Classification legend: **supported** / **supported-diff-impl** / **requires-network** /
**temporarily-unavailable** / **android-only** / **desktop-only** / **experimental-hidden** /
**launch-deferred**.

## Mobile navigation destinations (MobileNavigation.tsx)

| Surface | Classification | Capability id | iOS disposition |
|---|---|---|---|
| Dashboard | supported | `tab_dashboard` | available |
| Queue | supported | `tab_queue` | available |
| Review | supported | `tab_review` | available |
| Documents | supported | `tab_documents` | available |
| Settings | supported | `tab_settings` | available |
| Extracts | supported | `tab_extracts` | available (overflow) |
| Image registry | supported | `tab_image_registry` | available (overflow) |
| Document Q&A | supported | `tab_doc_qa` | available (overflow) |
| RSS reader | requires-network | `tab_rss` | available (network required, fine) |
| Newsletter directory | requires-network | `tab_newsletter` | available |
| Analytics | supported | `tab_analytics` | available (overflow) |
| Podcasts | requires-network | `tab_podcast` | available (Media3-free playback via webview audio verified in code paths shared with Android) |
| Audiobooks | supported | `tab_audiobook` | available (overflow) |
| Knowledge sphere | supported (perf: verify on device — G) | `tab_knowledge_sphere` | available (overflow) |
| NotebookLM | desktop-only (external `notebooklm-py` CLI) | `tab_notebooklm` | **hidden** (§2.5); deep-link falls back doc-qa → documents → dashboard |

## Protected core workflow (§4)

| Surface | Classification | Capability id |
|---|---|---|
| Import (EnhancedFilePicker local/URL/Arxiv/Anki/JSON) | supported | `core_import` |
| Read (DocumentViewer / queue scroll) | supported | `core_read` |
| Extract (highlight → extract) | supported | `core_extract` |
| Remember (flashcards / decks) | supported | `core_remember` |
| Review (SRS sessions) | supported | `core_review` |

## Settings sections (SettingsPage.tsx + panels)

| Surface | Classification | Capability id | iOS disposition |
|---|---|---|---|
| General (language, views, caps) | supported | — (ungated, no platform mechanics) | unchanged |
| App version + Check for Updates row | desktop-only on iOS (self-update; App Review 2.5.2) | `app_updater` | **hidden on iOS only**; desktop + Android sideload unchanged |
| Data location / open folder | desktop-only mechanics; row already gated by `isTauri()`-desktop loading | — | hidden via existing `isDesktop` gate (no change) |
| TTS: cloud providers (Groq/fal/OpenRouter…) | requires-network | — | available (verified: direct HTTPS, no native bridge) |
| TTS: System voice (speechSynthesis) | supported-diff-impl | — | available (AVSpeechSynthesizer via WKWebView) |
| TTS: Pocket sidecar | desktop-only (already gated `isTauri() && !isNativeMobile()`) | — | correctly hidden; note copy already iOS-safe |
| TTS: Android on-device adapter | android-only | `tts_android_adapter` | **hidden on iOS** (§2.1 — was the verified leak) |
| On-device AI (Gemini Nano panel) | android-only (already correct, OnDeviceAiPanel) | `on_device_ai_gemini_nano` | hidden (no change; registered for matrix completeness) |
| Integrations: Obsidian/Anki | supported | — | unchanged |
| Integrations: browser-extension server | desktop-only (localhost socket) | `browser_extension_server` | **hidden tab on iOS** (§2.4) |
| Integrations: NotebookLM workspace | desktop-only | `notebooklm_cli` | **hidden tab on iOS** (§2.5) |
| Integrations: YouTube / cookies / transcript | requires-network | — | unchanged |
| API & Webhooks | supported | — | unchanged |
| Privacy tab | supported (Change C owns content) | — | D gates nothing here |
| Notifications / appearance / etc. | supported | — | unchanged |

## Import sources (EnhancedFilePicker.tsx)

| Source | Classification | Capability id | iOS disposition |
|---|---|---|---|
| Local files | supported (WebView file input → SAF/Files picker) | `core_import` | available |
| Folder | supported-diff-impl (SAF on Android; Files on iOS) | `core_import` | available |
| URL / Arxiv | requires-network | `core_import` | available |
| **Screenshot capture** | desktop-only (nothing to capture in a mobile webview; `screenshotCapture.ts` early-returns) | `import_screenshot` | **hidden on mobile** (§2.3) |
| Anki / JSON | supported | `core_import` | available |

## Toolbar / reader actions

| Surface | Classification | Capability id | iOS disposition |
|---|---|---|---|
| Reader selection actions, extract capture, TTS controls, dictionary | supported | `core_extract` / `core_read` | available |
| NotebookLM toolbar button | desktop-only | `tab_notebooklm` | **hidden on iOS** (§2.5) |
| Screenshot region capture (CreateExtractDialog `captureAppWindowRegion`) | desktop-only (already gated `!isNativeMobile()`) | — | correct, no change |

## Command palette / CommandCenter

| Command | Classification | Capability id |
|---|---|---|
| Import document | supported | `core_import` |
| Create flashcard | supported | `core_remember` |
| Start review / optimal session | supported | `core_review` / `core_read` |
| Go to documents/queue/analytics/images/settings | supported | matching `tab_*` ids |
| Paste extract | supported | `core_extract` |
| Import Twitter/X video | requires-network + Rust backend (works on mobile Tauri) | — ungated-with-rationale: Rust backend ships on iOS too |
| Smart tagging / tag cleanup | supported | — |
| Theme / shortcuts / tour / keyboard help | supported | — |

No palette command required removal on iOS; gating is capability-driven so
future desktop-only commands are excluded automatically.

## Off-platform native commands (§2.7)

| Command | Reachability after fixes |
|---|---|
| `plugin:plethora-folder-import\|install_apk` | Only inside `updateChecker`'s Android-only updater handle (`nativePlatform() === 'android'` guard at the construction site); the sole UI entry point (Settings updater row) is hidden on iOS via `app_updater`. |
| `capture_rendered_dom` (desktop) | Only via `desktopCapture` client; `getCaptureClient()` selects it for desktop only — iOS resolves to typed `unavailable` (matrix native:false/iframe:false). |

## Remaining `isNativeMobile()` audit (§2.6)

Spot-audited call sites for the "android-only bridge shown on iOS" class:

- `updateChecker.ts:327` — desktop idiom, correct; APK branch guarded `nativePlatform()==='android'`. ✔
- `AudioTranscriptionSettings.tsx:78` — `isTauri() && !isNativeMobile()` desktop idiom. ✔
- `CreateExtractDialog.tsx:332` — desktop-only window capture. ✔
- `PodcastManager.tsx:972`, `useTranscriptionResolution.ts` — transcription routing key, valid on iOS. ✔
- `api/tts/android/bridge.ts`, `api/tts/providers/android.ts`, `useNativeAndroidTTS.ts` — bridge internals; UI entry now registry-gated (§2.1). ✔
- `useTTS.ts`, `ReaderTTSControls.tsx`, `TTSSetupSheet.tsx` — provider resolution follows the settings adapter list; adapter hidden on iOS ⇒ unreachable. ✔
- `screenshotCapture.ts`, `captureClient.ts` — early-return / typed-unavailable on mobile. ✔
- `PWAComponents.tsx`, `NotificationSettings.tsx`, `displayMode.ts`, `presentation.ts`, etc. — mobile-vs-desktop chrome decisions, not android-only bridges. ✔

No additional android-only-on-iOS leaks found beyond the five verified ones.

## Share-extension slot (Change E)

- `share_extension_inbox` registered: gateable surfaces are the startup
  pending-share drain (`fetchPendingShares` in `useShareTarget.ts`) and the
  pending-shares retry notice. Available on iOS + Android; unavailable
  desktop/web. E owns the implementation; D owns the slot.

## Intentional cross-platform deltas (sanctioned by tasks; not regressions)

- `import_screenshot`: now hidden on **Android** too (dead button there —
  capture early-returns). Sanctioned by task 2.3 ("hide on mobile").
- `tab_notebooklm` / `notebooklm_cli`: now desktop-only (was reachable on
  Android/web where the CLI cannot run). Sanctioned by task 2.5 ("gate to
  desktop").
- `browser_extension_server`: desktop-only (was rendered in mobile webviews).
  Sanctioned by task 2.4.
- `tts_android_adapter`, `app_updater` on iOS: the verified leak fixes.
  Android behavior unchanged for both.
