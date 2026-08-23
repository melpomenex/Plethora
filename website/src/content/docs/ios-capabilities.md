---
title: "iOS Feature Availability"
description: "Platform capability registry governing which destinations, commands, and settings are available on iOS — hidden-vs-marked-unavailable semantics, test-enforced against the registry."
category: "platforms-and-devices"
order: 100
published: true
featureStatus: "shipping"
platforms: ["mobile-ios"]
keywords: ["ios capabilities","ios feature matrix","platform gating"]
aliases: ["ios capabilities","ios feature matrix","platform gating"]
relatedDocs: ["platform.mobile_android","platform.eink","platform.desktop"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/platform/ios-capabilities.md"
---
# iOS Feature Availability

## Purpose
Central registry (`src/lib/platformCapabilities.ts`) classifying every
user-visible destination, command, and settings surface per platform, with
iOS as the first fully-populated column. Unknown capability ids fail closed
with a dev warning. APK-install-class surfaces (self-update / sideload
install) are additionally unavailable on **every** platform under the
`store` build profile (`BUILD_PROFILE=store`).

## User-Facing Behavior
- Core workflow (Import → Read → Extract → Remember → Review) is **protected**:
  the five `core_*` capabilities are guaranteed available on iOS phone and
  tablet form factors (test-enforced).
- Hidden on iOS (no discoverability value): Android on-device TTS adapter,
  screenshot capture import source, browser-extension sync server, NotebookLM
  CLI workspace, app self-update row, APK install, desktop DOM capture.
- Marked unavailable (discoverability matters): overflow-sheet destinations
  whose capability is unavailable render as a disabled row with an i18n'd
  reason string (`platform.unavailable.*`).
- Deep links and restored sessions to a hidden surface land on the nearest
  available surface (e.g. NotebookLM → Document Q&A → Documents → Dashboard).
- The iOS Share Extension inbox (staged pending-share drain + retry notice)
  is available on iOS and Android (`share_extension_inbox`).

## Exact Behavioral Rules
1. A registry entry without a platform column means available on that
   platform — desktop and Android behavior is frozen by a regression
   snapshot test.
2. Unknown capability id → fail closed + dev-mode console error.
3. `apkInstallClass` capabilities are unavailable on all platforms when
   `BUILD_PROFILE === "store"`.
4. The doc matrix below is generated from the registry and verified by
   `iosCapabilitiesDoc.test.ts`; edit the registry, then regenerate.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `platform.unavailable.*` (i18n) | — | Reason strings for marked-unavailable surfaces, all six locales. |

## Platform Behavior
- **iOS**: matrix below applies; protected core workflow fully available.
- **Android / Desktop / Web**: unchanged shipped behavior (snapshot-enforced),
  with the sanctioned §2 fixes (screenshot source hidden on mobile,
  NotebookLM/extension-server desktop-only).

<!-- BEGIN GENERATED MATRIX -->
| Capability id | Kind | iOS | Android | Desktop | Web/PWA |
| --- | --- | --- | --- | --- | --- |
| `core_import` | **protected** | ✅ | ✅ | ✅ | ✅ |
| `core_read` | **protected** | ✅ | ✅ | ✅ | ✅ |
| `core_extract` | **protected** | ✅ | ✅ | ✅ | ✅ |
| `core_remember` | **protected** | ✅ | ✅ | ✅ | ✅ |
| `core_review` | **protected** | ✅ | ✅ | ✅ | ✅ |
| `tab_dashboard` |  | ✅ | ✅ | ✅ | ✅ |
| `tab_queue` |  | ✅ | ✅ | ✅ | ✅ |
| `tab_review` |  | ✅ | ✅ | ✅ | ✅ |
| `tab_documents` |  | ✅ | ✅ | ✅ | ✅ |
| `tab_settings` |  | ✅ | ✅ | ✅ | ✅ |
| `tab_extracts` |  | ✅ | ✅ | ✅ | ✅ |
| `tab_image_registry` |  | ✅ | ✅ | ✅ | ✅ |
| `tab_doc_qa` |  | ✅ | ✅ | ✅ | ✅ |
| `tab_rss` |  | ✅ | ✅ | ✅ | ✅ |
| `tab_newsletter` |  | ✅ | ✅ | ✅ | ✅ |
| `tab_analytics` |  | ✅ | ✅ | ✅ | ✅ |
| `tab_podcast` |  | ✅ | ✅ | ✅ | ✅ |
| `tab_audiobook` |  | ✅ | ✅ | ✅ | ✅ |
| `tab_knowledge_sphere` |  | ✅ | ✅ | ✅ | ✅ |
| `tab_notebooklm` |  | `❌ unsupported_platform` | `❌ unsupported_platform` | ✅ | `❌ unsupported_platform` |
| `tts_android_adapter` |  | `❌ unsupported_platform` | ✅ | `❌ unsupported_platform` | `❌ unsupported_platform` |
| `app_updater` | apk-install-class | `❌ unsupported_platform` | ✅ | ✅ | `❌ unsupported_platform` |
| `import_screenshot` |  | `❌ unsupported_platform` | `❌ unsupported_platform` | ✅ | ✅ |
| `browser_extension_server` |  | `❌ unsupported_platform` | `❌ unsupported_platform` | ✅ | `❌ unsupported_platform` |
| `notebooklm_cli` |  | `❌ unsupported_platform` | `❌ unsupported_platform` | ✅ | `❌ unsupported_platform` |
| `apk_install` | apk-install-class | `❌ unsupported_platform` | ✅ | `❌ unsupported_platform` | `❌ unsupported_platform` |
| `desktop_capture_dom` |  | `❌ unsupported_platform` | `❌ unsupported_platform` | ✅ | `❌ unsupported_platform` |
| `share_extension_inbox` |  | ✅ | ✅ | `❌ unsupported_platform` | `❌ unsupported_platform` |
| `on_device_ai_gemini_nano` |  | `❌ unsupported_platform` | ✅ | `❌ unsupported_platform` | `❌ unsupported_platform` |
| `on_device_ai_apple_foundation` |  | ✅ | `❌ unsupported_platform` | ✅ | `❌ unsupported_platform` |
| `apple_speech_transcription` |  | ✅ | `❌ unsupported_platform` | ✅ | `❌ unsupported_platform` |
| `import_document_scan` |  | ✅ | `❌ unsupported_platform` | ✅ | `❌ unsupported_platform` |
| `import_photo_library` |  | ✅ | `❌ unsupported_platform` | ✅ | `❌ unsupported_platform` |
| `apple_spotlight_search` |  | ✅ | `❌ unsupported_platform` | ✅ | `❌ unsupported_platform` |
| `on_device_ai_apple_coreai` |  | ✅ | `❌ unsupported_platform` | ✅ | `❌ unsupported_platform` |
<!-- END GENERATED MATRIX -->