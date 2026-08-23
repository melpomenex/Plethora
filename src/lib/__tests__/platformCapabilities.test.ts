import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Platform capability registry tests (Change D — ios-feature-availability).
 *
 * Covers:
 *  - §1.2 registry shape / fail-closed unknown ids with dev warning
 *  - §1.5 desktop + Android regression snapshot (registry introduction must
 *    not change shipped behavior beyond the sanctioned §2 iOS fixes)
 *  - §4.1 protected core-workflow capabilities available on iOS phone+tablet
 *  - §5.1 store-profile invariant: apk-install-class capabilities unavailable
 *    on EVERY platform under the store profile (profile injected via options,
 *    never by mutating BUILD_PROFILE)
 */

async function loadFresh() {
  vi.resetModules();
  return await import("../platformCapabilities");
}

type PC = typeof import("../platformCapabilities");

interface WindowState {
  tauri?: boolean;
  osPlatform?: string | null;
}

function applyWindowState(state: WindowState) {
  const w = window as unknown as Record<string, unknown>;
  if (state.tauri) {
    w["__TAURI_INTERNALS__"] = { invoke: vi.fn() };
  } else {
    delete w["__TAURI_INTERNALS__"];
  }
  if (state.osPlatform) {
    w["__TAURI_OS_PLUGIN_INTERNALS__"] = {
      platform: state.osPlatform,
      os_type: state.osPlatform,
    };
  } else {
    delete w["__TAURI_OS_PLUGIN_INTERNALS__"];
  }
}

describe("platformCapabilities — resolution", () => {
  beforeEach(() => {
    vi.stubGlobal("console", { ...console, error: vi.fn(), warn: vi.fn() });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves the current app platform from the OS plugin internals", async () => {
    applyWindowState({ tauri: true, osPlatform: "ios" });
    let pc: PC = await loadFresh();
    expect(pc.resolveCurrentAppPlatform()).toBe("ios");

    applyWindowState({ tauri: true, osPlatform: "android" });
    pc = await loadFresh();
    expect(pc.resolveCurrentAppPlatform()).toBe("android");

    // Desktop Tauri build: OS plugin reports a desktop OS string.
    applyWindowState({ tauri: true, osPlatform: "macos" });
    pc = await loadFresh();
    expect(pc.resolveCurrentAppPlatform()).toBe("desktop");

    // UA fallback (OS plugin internals absent): iOS Tauri webview still
    // classifies as ios. (The jsdom harness keeps a non-configurable
    // window.__TAURI__, so the pure-browser → "web" branch is covered by
    // build/CI rather than this suite.)
    applyWindowState({ tauri: true });
    vi.stubGlobal("navigator", {
      ...navigator,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    });
    pc = await loadFresh();
    expect(pc.resolveCurrentAppPlatform()).toBe("ios");
    vi.unstubAllGlobals();
  });

  it("fails closed with a dev console error for unknown capability ids", async () => {
    applyWindowState({});
    const pc = await loadFresh();
    const result = pc.getPlatformCapability("not_a_real_id" as never);
    expect(result).toEqual({
      available: false,
      reason: "unsupported_platform",
    });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Unknown capability id "not_a_real_id"')
    );
  });

  it("treats a missing platform column as available (preserve behavior)", async () => {
    applyWindowState({});
    const pc = await loadFresh();
    // tab_dashboard declares no overrides → available everywhere.
    for (const platform of ["ios", "android", "desktop", "web"] as const) {
      expect(
        pc.isPlatformCapabilityAvailable("tab_dashboard", { platform })
      ).toBe(true);
    }
  });
});

describe("§4.1 protected core workflow", () => {
  it("all five protected capabilities are available on iOS", async () => {
    applyWindowState({});
    const pc = await loadFresh();
    for (const id of pc.PROTECTED_PLATFORM_CAPABILITY_IDS) {
      expect(pc.isPlatformCapabilityAvailable(id, { platform: "ios" })).toBe(
        true
      );
      expect(
        pc.PLATFORM_CAPABILITY_REGISTRY[id].protected
      ).toBe(true);
    }
  });

  it("every protected id exists in the registry", async () => {
    const pc = await loadFresh();
    for (const id of pc.PROTECTED_PLATFORM_CAPABILITY_IDS) {
      expect(pc.PLATFORM_CAPABILITY_REGISTRY[id]).toBeDefined();
    }
  });
});

describe("§5.1 store-profile invariant", () => {
  it("apk-install-class capabilities are unavailable on every platform under the store profile", async () => {
    applyWindowState({});
    const pc = await loadFresh();
    const apkClassIds = (
      Object.values(pc.PLATFORM_CAPABILITY_REGISTRY) as Array<
        PC["PLATFORM_CAPABILITY_REGISTRY"][PC["PLATFORM_CAPABILITY_IDS"][number]]
      >
    )
      .filter((d) => d.apkInstallClass)
      .map((d) => d.id);

    expect(apkClassIds).toContain("apk_install");
    expect(apkClassIds).toContain("app_updater");

    for (const id of apkClassIds) {
      for (const platform of ["ios", "android", "desktop", "web"] as const) {
        const availability = pc.getPlatformCapability(id, {
          platform,
          buildProfile: "store",
        });
        expect(availability.available, `${id} on ${platform}`).toBe(false);
      }
    }
  });

  it("does not affect non-apk-class capabilities under the store profile", async () => {
    applyWindowState({});
    const pc = await loadFresh();
    expect(
      pc.isPlatformCapabilityAvailable("core_import", {
        platform: "ios",
        buildProfile: "store",
      })
    ).toBe(true);
  });

  it("keeps android sideload self-update available outside the store profile", async () => {
    applyWindowState({});
    const pc = await loadFresh();
    expect(
      pc.isPlatformCapabilityAvailable("app_updater", {
        platform: "android",
        buildProfile: "development",
      })
    ).toBe(true);
  });
});

describe("§2 verified iOS leak classifications", () => {
  it("hides the verified-leak surfaces on iOS while preserving desktop/Android", async () => {
    applyWindowState({});
    const pc = await loadFresh();

    // Android TTS adapter: android only.
    expect(pc.isPlatformCapabilityAvailable("tts_android_adapter", { platform: "android" })).toBe(true);
    expect(pc.isPlatformCapabilityAvailable("tts_android_adapter", { platform: "ios" })).toBe(false);

    // Updater row: real desktop + Android sideload only, never iOS/web.
    expect(pc.isPlatformCapabilityAvailable("app_updater", { platform: "desktop" })).toBe(true);
    expect(pc.isPlatformCapabilityAvailable("app_updater", { platform: "ios" })).toBe(false);
    expect(pc.isPlatformCapabilityAvailable("app_updater", { platform: "web" })).toBe(false);

    // Screenshot import source: hidden on mobile.
    expect(pc.isPlatformCapabilityAvailable("import_screenshot", { platform: "ios" })).toBe(false);
    expect(pc.isPlatformCapabilityAvailable("import_screenshot", { platform: "android" })).toBe(false);
    expect(pc.isPlatformCapabilityAvailable("import_screenshot", { platform: "desktop" })).toBe(true);

    // Browser-extension server controls and NotebookLM CLI: desktop-only.
    for (const id of [
      "browser_extension_server",
      "notebooklm_cli",
    ] as const) {
      expect(pc.isPlatformCapabilityAvailable(id, { platform: "ios" })).toBe(false);
      expect(pc.isPlatformCapabilityAvailable(id, { platform: "desktop" })).toBe(true);
    }
    expect(pc.isPlatformCapabilityAvailable("tab_notebooklm", { platform: "ios" })).toBe(false);
    expect(pc.isPlatformCapabilityAvailable("tab_notebooklm", { platform: "desktop" })).toBe(true);

    // Off-platform native commands unreachable from iOS UI.
    expect(pc.isPlatformCapabilityAvailable("apk_install", { platform: "ios" })).toBe(false);
    expect(pc.isPlatformCapabilityAvailable("desktop_capture_dom", { platform: "ios" })).toBe(false);

    // Share-extension inbox (Change E slot): native mobile only.
    expect(pc.isPlatformCapabilityAvailable("share_extension_inbox", { platform: "ios" })).toBe(true);
    expect(pc.isPlatformCapabilityAvailable("share_extension_inbox", { platform: "android" })).toBe(true);
    expect(pc.isPlatformCapabilityAvailable("share_extension_inbox", { platform: "desktop" })).toBe(false);
  });
});

describe("§1.5 desktop + Android regression snapshot", () => {
  /**
   * Frozen matrix of the post-fix expected availability per id on desktop and
   * Android. Registry introduction must not drift these columns; any change
   * here is an intentional cross-platform behavior change and needs review.
   */
  const DESKTOP_ANDROID_SNAPSHOT = {
    core_import: { desktop: true, android: true },
    core_read: { desktop: true, android: true },
    core_extract: { desktop: true, android: true },
    core_remember: { desktop: true, android: true },
    core_review: { desktop: true, android: true },
    tab_dashboard: { desktop: true, android: true },
    tab_queue: { desktop: true, android: true },
    tab_review: { desktop: true, android: true },
    tab_documents: { desktop: true, android: true },
    tab_settings: { desktop: true, android: true },
    tab_extracts: { desktop: true, android: true },
    tab_image_registry: { desktop: true, android: true },
    tab_doc_qa: { desktop: true, android: true },
    tab_rss: { desktop: true, android: true },
    tab_newsletter: { desktop: true, android: true },
    tab_analytics: { desktop: true, android: true },
    tab_podcast: { desktop: true, android: true },
    tab_audiobook: { desktop: true, android: true },
    tab_knowledge_sphere: { desktop: true, android: true },
    tab_notebooklm: { desktop: true, android: false },
    tts_android_adapter: { desktop: false, android: true },
    app_updater: { desktop: true, android: true },
    import_screenshot: { desktop: true, android: false },
    browser_extension_server: { desktop: true, android: false },
    notebooklm_cli: { desktop: true, android: false },
    apk_install: { desktop: false, android: true },
    desktop_capture_dom: { desktop: true, android: false },
    share_extension_inbox: { desktop: false, android: true },
    on_device_ai_gemini_nano: { desktop: false, android: true },
    on_device_ai_apple_foundation: { desktop: true, android: false },
    apple_speech_transcription: { desktop: true, android: false },
    import_document_scan: { desktop: true, android: false },
    import_photo_library: { desktop: true, android: false },
    apple_spotlight_search: { desktop: true, android: false },
    on_device_ai_apple_coreai: { desktop: true, android: false },
  } as const;

  it("matches the frozen desktop/android availability snapshot exactly", async () => {
    applyWindowState({});
    const pc = await loadFresh();
    const actual: Record<string, { desktop: boolean; android: boolean }> = {};
    for (const id of pc.PLATFORM_CAPABILITY_IDS) {
      actual[id] = {
        desktop: pc.isPlatformCapabilityAvailable(id, { platform: "desktop" }),
        android: pc.isPlatformCapabilityAvailable(id, { platform: "android" }),
      };
    }
    expect(actual).toEqual(DESKTOP_ANDROID_SNAPSHOT);
  });

  it("registers every id with a well-formed definition", async () => {
    applyWindowState({});
    const pc = await loadFresh();
    for (const id of pc.PLATFORM_CAPABILITY_IDS) {
      const def = pc.PLATFORM_CAPABILITY_REGISTRY[id];
      expect(def, `missing registry entry for ${id}`).toBeDefined();
      expect(def.id).toBe(id);
      expect(def.platforms).toBeTypeOf("object");
    }
  });
});
