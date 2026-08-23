/**
 * Platform capability registry (Change D — ios-feature-availability).
 *
 * One registry answering "is <surface> available on <platform>, and why not?"
 * for every user-visible destination/command/setting. Mirrors the billing
 * entitlements registry shape (`src/types/entitlements.ts` `{ enabled, reason }`)
 * but on the platform axis, not the plan axis.
 *
 * Semantics:
 *  - A registry entry missing a platform column means AVAILABLE on that
 *    platform (preserves current behavior; desktop/Android must be unchanged).
 *  - An id missing from the registry entirely fails CLOSED with a dev-mode
 *    console error (never silently available).
 *  - `apkInstallClass` capabilities are unavailable on EVERY platform when the
 *    build profile is `store` (App Store / Play Store policy: no self-update
 *    or sideload-install surfaces in store builds). Consumes Change A's
 *    `BUILD_PROFILE` read-only.
 *
 * Ownership: Change D exclusively. Other proposals (B/C/E/F) register their
 * gateable surfaces here via enum-id additions only.
 */

import { isTauri, nativePlatform } from "./tauri";
import { BUILD_PROFILE, type BuildProfile } from "./buildProfile";

/** Coarse runtime platform axis the registry classifies against. */
export type AppPlatform = "ios" | "android" | "desktop" | "web";

export type PlatformCapabilityReason =
  | "unsupported_platform"
  | "requires_network"
  | "launch_deferred"
  | "experimental";

export type PlatformAvailability =
  | { available: true }
  | {
      available: false;
      reason: PlatformCapabilityReason;
      /** i18n key (all locales) explaining the unavailability, when discoverability matters. */
      explanationKey?: string;
    };

/**
 * The five protected core-workflow capabilities (Import → Read → Extract →
 * Remember → Review). The protected-surface test asserts all of these are
 * available on iOS phone AND tablet form factors.
 */
export const PROTECTED_PLATFORM_CAPABILITY_IDS = [
  "core_import",
  "core_read",
  "core_extract",
  "core_remember",
  "core_review",
] as const;

export const PLATFORM_CAPABILITY_IDS = [
  ...PROTECTED_PLATFORM_CAPABILITY_IDS,
  // Mobile navigation destinations (TabRegistry / MobileNavigation)
  "tab_dashboard",
  "tab_queue",
  "tab_review",
  "tab_documents",
  "tab_settings",
  "tab_extracts",
  "tab_image_registry",
  "tab_doc_qa",
  "tab_rss",
  "tab_newsletter",
  "tab_analytics",
  "tab_podcast",
  "tab_audiobook",
  "tab_knowledge_sphere",
  "tab_notebooklm",
  // Verified iOS leak surfaces (§2)
  "tts_android_adapter",
  "app_updater",
  "import_screenshot",
  "browser_extension_server",
  "notebooklm_cli",
  // Off-platform native commands
  "apk_install",
  "desktop_capture_dom",
  // Change E's share-extension gateable surface (startup pending-share drain
  // + pending-shares notice). Slot reserved per the parallelization plan.
  "share_extension_inbox",
  // Android on-device Gemini Nano panel (already correctly gated; registered
  // so the audit matrix is complete).
  "on_device_ai_gemini_nano",
  "on_device_ai_apple_foundation",
  "apple_speech_transcription",
  "import_document_scan",
  "import_photo_library",
  "apple_spotlight_search",
  "on_device_ai_apple_coreai",
] as const;

export type PlatformCapabilityId = (typeof PLATFORM_CAPABILITY_IDS)[number];

export interface PlatformCapabilityDefinition {
  id: PlatformCapabilityId;
  /**
   * Core-workflow surface — must never be hidden on iOS phone/tablet.
   * Enforced by the protected-surface test.
   */
  protected?: boolean;
  /**
   * APK-install-class surface (self-update / sideload install). Unavailable
   * on EVERY platform under the `store` build profile.
   */
  apkInstallClass?: boolean;
  /**
   * Per-platform overrides. A missing platform means available there
   * (preserve current behavior). Only iOS-unavailable entries constitute
   * behavior changes; desktop and Android columns must match shipped behavior.
   */
  platforms: Partial<Record<AppPlatform, PlatformAvailability>>;
}

const unavailable = (
  reason: PlatformCapabilityReason = "unsupported_platform",
  explanationKey?: string
): PlatformAvailability => ({ available: false, reason, explanationKey });

const DESKTOP_ONLY: Partial<Record<AppPlatform, PlatformAvailability>> = {
  ios: unavailable("unsupported_platform"),
  android: unavailable("unsupported_platform"),
  web: unavailable("unsupported_platform"),
};

export const PLATFORM_CAPABILITY_REGISTRY: Record<
  PlatformCapabilityId,
  PlatformCapabilityDefinition
> = {
  // ── Protected core workflow ────────────────────────────────────────────────
  core_import: { id: "core_import", protected: true, platforms: {} },
  core_read: { id: "core_read", protected: true, platforms: {} },
  core_extract: { id: "core_extract", protected: true, platforms: {} },
  core_remember: { id: "core_remember", protected: true, platforms: {} },
  core_review: { id: "core_review", protected: true, platforms: {} },

  // ── Mobile navigation destinations ────────────────────────────────────────
  // All supported on iOS per the audit (RSS/podcast/audiobooks/analytics/
  // knowledge-sphere verified as supported or requires-network-capable);
  // only NotebookLM is desktop-only (external `notebooklm-py` CLI).
  tab_dashboard: { id: "tab_dashboard", platforms: {} },
  tab_queue: { id: "tab_queue", platforms: {} },
  tab_review: { id: "tab_review", platforms: {} },
  tab_documents: { id: "tab_documents", platforms: {} },
  tab_settings: { id: "tab_settings", platforms: {} },
  tab_extracts: { id: "tab_extracts", platforms: {} },
  tab_image_registry: { id: "tab_image_registry", platforms: {} },
  tab_doc_qa: { id: "tab_doc_qa", platforms: {} },
  tab_rss: { id: "tab_rss", platforms: {} },
  tab_newsletter: { id: "tab_newsletter", platforms: {} },
  tab_analytics: { id: "tab_analytics", platforms: {} },
  tab_podcast: { id: "tab_podcast", platforms: {} },
  tab_audiobook: { id: "tab_audiobook", platforms: {} },
  tab_knowledge_sphere: { id: "tab_knowledge_sphere", platforms: {} },
  tab_notebooklm: {
    id: "tab_notebooklm",
    platforms: {
      ios: unavailable("unsupported_platform", "platform.unavailable.notebooklm"),
      android: unavailable("unsupported_platform", "platform.unavailable.notebooklm"),
      web: unavailable("unsupported_platform", "platform.unavailable.notebooklm"),
    },
  },

  // ── Verified iOS leak fixes ───────────────────────────────────────────────
  // Android on-device TTS bridge (api/tts/android/bridge.ts) cannot exist on
  // iOS; cloud TTS providers remain available there (requires-network, fine).
  tts_android_adapter: {
    id: "tts_android_adapter",
    platforms: {
      ios: unavailable("unsupported_platform"),
      desktop: unavailable("unsupported_platform"),
      web: unavailable("unsupported_platform"),
    },
  },
  // Self-update surface. Hidden on iOS (App Review 2.5.2 / storeReleaseReadiness
  // `selfUpdaterDisabled = isStoreBuild || platform === 'ios'`). Desktop and
  // Android (sideloaded APK self-update) keep current behavior.
  app_updater: {
    id: "app_updater",
    apkInstallClass: true,
    platforms: {
      ios: unavailable("unsupported_platform"),
      web: unavailable("unsupported_platform"),
    },
  },
  // Screen-capture import source: desktop-only mechanics (screenshotCapture
  // early-returns on mobile; nothing to capture inside a mobile webview).
  import_screenshot: {
    id: "import_screenshot",
    platforms: {
      ios: unavailable("unsupported_platform"),
      android: unavailable("unsupported_platform"),
    },
  },
  // Browser-extension local sync server: needs a desktop localhost socket.
  browser_extension_server: {
    id: "browser_extension_server",
    platforms: DESKTOP_ONLY,
  },
  // NotebookLM integration depends on the external `notebooklm-py` CLI.
  notebooklm_cli: {
    id: "notebooklm_cli",
    platforms: DESKTOP_ONLY,
  },

  // ── Off-platform native commands ─────────────────────────────────────────
  // Android APK install command (folder-import plugin). Never invoked on iOS
  // because no iOS-reachable UI path remains once `app_updater` is hidden.
  apk_install: {
    id: "apk_install",
    apkInstallClass: true,
    platforms: {
      ios: unavailable("unsupported_platform"),
      desktop: unavailable("unsupported_platform"),
      web: unavailable("unsupported_platform"),
    },
  },
  // Desktop hidden-window DOM capture command. iOS capture matrix is
  // native:false/iframe:false (captureClient.ts) — the UI never reaches it.
  desktop_capture_dom: {
    id: "desktop_capture_dom",
    platforms: {
      ios: unavailable("unsupported_platform"),
      android: unavailable("unsupported_platform"),
      web: unavailable("unsupported_platform"),
    },
  },

  // ── Change E slot: iOS Share Extension ───────────────────────────────────
  // Gateable surfaces: startup pending-share drain (fetchPendingShares) and
  // the pending-shares retry notice. Available on both native mobile platforms
  // (Android share target + iOS App Group staged manifests); not on desktop/web.
  share_extension_inbox: {
    id: "share_extension_inbox",
    platforms: {
      desktop: unavailable("unsupported_platform"),
      web: unavailable("unsupported_platform"),
    },
  },

  // ── Android on-device AI (registered for matrix completeness) ────────────
  on_device_ai_gemini_nano: {
    id: "on_device_ai_gemini_nano",
    platforms: {
      ios: unavailable("unsupported_platform"),
      desktop: unavailable("unsupported_platform"),
      web: unavailable("unsupported_platform"),
    },
  },

  on_device_ai_apple_foundation: {
    id: "on_device_ai_apple_foundation",
    platforms: {
      android: unavailable("unsupported_platform"),
      web: unavailable("unsupported_platform"),
    },
  },
  apple_speech_transcription: {
    id: "apple_speech_transcription",
    platforms: {
      android: unavailable("unsupported_platform"),
      web: unavailable("unsupported_platform"),
    },
  },
  import_document_scan: {
    id: "import_document_scan",
    platforms: {
      android: unavailable("unsupported_platform"),
      web: unavailable("unsupported_platform"),
    },
  },
  import_photo_library: {
    id: "import_photo_library",
    platforms: {
      android: unavailable("unsupported_platform"),
      web: unavailable("unsupported_platform"),
    },
  },
  apple_spotlight_search: {
    id: "apple_spotlight_search",
    platforms: {
      android: unavailable("unsupported_platform"),
      web: unavailable("unsupported_platform"),
    },
  },
  on_device_ai_apple_coreai: {
    id: "on_device_ai_apple_coreai",
    platforms: {
      android: unavailable("unsupported_platform"),
      web: unavailable("unsupported_platform"),
    },
  },
};

export interface CapabilityQueryOptions {
  /** Override the runtime-detected platform (tests / matrix generation). */
  platform?: AppPlatform;
  /** Override the build profile (tests inject; never mutate BUILD_PROFILE). */
  buildProfile?: BuildProfile;
}

/**
 * Resolve the coarse platform axis from the detection utilities in
 * `src/lib/tauri.ts`. Synchronous; stable for the lifetime of the app.
 */
export function resolveCurrentAppPlatform(): AppPlatform {
  const native = nativePlatform();
  if (native === "ios") return "ios";
  if (native === "android") return "android";
  if (native) return "desktop";
  if (typeof navigator !== "undefined") {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod")) {
      // UA fallback for webview builds where the OS plugin internals are absent.
      return isTauri() ? "ios" : "web";
    }
    if (ua.includes("android")) {
      return isTauri() ? "android" : "web";
    }
  }
  return isTauri() ? "desktop" : "web";
}

/**
 * Resolve a capability's availability. Unknown ids fail CLOSED with a
 * dev-mode console error (production: silent fail-closed, id logged).
 */
export function getPlatformCapability(
  id: PlatformCapabilityId,
  options: CapabilityQueryOptions = {}
): PlatformAvailability {
  const def = (PLATFORM_CAPABILITY_REGISTRY as Record<
    string,
    PlatformCapabilityDefinition | undefined
  >)[id];
  if (!def) {
    // Dev warning — surfaced in development/simulator builds only.
    if (import.meta.env?.DEV) {
      console.error(
        `[platformCapabilities] Unknown capability id "${id}" — failing closed.`
      );
    } else {
      console.warn(`[platformCapabilities] Unknown capability id "${id}".`);
    }
    return unavailable("unsupported_platform");
  }

  // Store-profile invariant: APK-install-class surfaces are unavailable on
  // EVERY platform in store builds (no self-update / sideload in store apps).
  const profile = options.buildProfile ?? BUILD_PROFILE;
  if (def.apkInstallClass && profile === "store") {
    return unavailable(
      "unsupported_platform",
      "platform.unavailable.storeBuild"
    );
  }

  const platform = options.platform ?? resolveCurrentAppPlatform();
  return def.platforms[platform] ?? { available: true };
}

/** Boolean convenience wrapper. */
export function isPlatformCapabilityAvailable(
  id: PlatformCapabilityId,
  options: CapabilityQueryOptions = {}
): boolean {
  return getPlatformCapability(id, options).available;
}

/** Type guard for the unavailable branch (strict mode is off repo-wide, so
 * discriminant narrowing on `available` doesn't apply — use this instead). */
export function isPlatformCapabilityUnavailable(
  availability: PlatformAvailability
): availability is Extract<PlatformAvailability, { available: false }> {
  return !availability.available;
}

/** Full availability matrix for every id × platform (doc generation / tests). */
export function buildCapabilityMatrix(
  options: Omit<CapabilityQueryOptions, "platform"> = {}
): Record<PlatformCapabilityId, Record<AppPlatform, PlatformAvailability>> {
  const platforms: AppPlatform[] = ["ios", "android", "desktop", "web"];
  const matrix = {} as Record<
    PlatformCapabilityId,
    Record<AppPlatform, PlatformAvailability>
  >;
  for (const id of PLATFORM_CAPABILITY_IDS) {
    const row = {} as Record<AppPlatform, PlatformAvailability>;
    for (const platform of platforms) {
      row[platform] = getPlatformCapability(id, { ...options, platform });
    }
    matrix[id] = row;
  }
  return matrix;
}
