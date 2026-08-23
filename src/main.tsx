// Early error handler - must be first
import { installPromiseCompat } from "./utils/promiseCompat";
// Incrementum → Plethora localStorage migration — MUST evaluate before any
// store module (zustand persist rehydrates at import time). The module runs
// the migration as an import side effect; see lib/brandMigration.ts.
import "./lib/brandMigration";
import { migratedGetItem } from "./lib/brandMigration";
import { installUint8ArrayCompat } from "./utils/uint8ArrayCompat";

if (typeof window !== 'undefined') {
  // Check for PWA Share Target redirect before React starts bootstrapping
  if (window.location.pathname === '/share-target') {
    const params = new URLSearchParams(window.location.search);
    const sharedText = params.get('url') || params.get('text') || params.get('title') || '';
    const urlRegex = /https?:\/\/[^\s]+/g;
    const match = sharedText.match(urlRegex);
    const extractedUrl = match ? match[0] : null;
    if (extractedUrl) {
      window.location.replace(`/#/?shared_url=${encodeURIComponent(extractedUrl)}`);
    } else {
      window.location.replace('/#/');
    }
  }

  // PDF.js uses newer Promise helpers that are missing in older WebView2 builds on Windows.
  installPromiseCompat(window);

  // PDF.js >= 5.4 calls Uint8Array.prototype.toHex() for PDF fingerprint computation.
  // This method was added in Chromium 130 (late 2024); older WebView2 runtimes don't have it.
  installUint8ArrayCompat(window);

  // Polyfill crypto.randomUUID for non-secure contexts (HTTP / Tailscale).
  // crypto.randomUUID() is only available in secure contexts (HTTPS or localhost).
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID !== 'function') {
    const randomUUID = function () {
      const s = '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c: string) =>
        ((Number(c) ^ (Math.random() * 256)) & 15 >> (Number(c) >> 4)).toString(16)
      );
      return s as `${string}-${string}-${string}-${string}-${string}`;
    };

    // WebKit can expose Crypto.randomUUID as a readonly native property even
    // when it is absent. A plain assignment then throws during module
    // evaluation, before ReactDOM.createRoot() is reached.
    try {
      Object.defineProperty(crypto, 'randomUUID', {
        configurable: true,
        value: randomUUID,
      });
    } catch {
      // The native property may be non-configurable. In that case leave it
      // alone; callers must feature-detect it rather than breaking startup.
    }
  }

  // Defensive patch for Tauri v2 event plugin bug (fallback — primary fix is in lib.rs init script):
  // https://github.com/tauri-apps/tauri/issues/8916
  // The unlisten JS injected by Tauri's Rust backend accesses listeners[eventId].handlerId
  // without null-checking, causing a TypeError. We suppress this specific error at the
  // window level since it's benign (the listener is already gone).
  try {
    window.addEventListener("error", (e) => {
      if (e.message && e.message.includes("listeners[eventId].handlerId")) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return false;
      }
    }, true); // capture phase to intercept before React's handler
  } catch { /* ignore */ }

  window.addEventListener('error', (e) => {
    const root = document.getElementById('root');

    // Chromium sometimes emits this as an "error" event even though it's a benign
    // ResizeObserver warning. Our early handler is intentionally aggressive for
    // startup failures, so we must ignore it to avoid nuking the UI.
    const message = e.message || "";
    if (
      message.includes("ResizeObserver loop limit exceeded") ||
      message.includes("ResizeObserver loop completed with undelivered notifications")
    ) {
      e.preventDefault();
      e.stopImmediatePropagation?.();
      return;
    }

    // Only replace the app UI during initial bootstrap. After React mounts,
    const isMounted = root?.getAttribute("data-plethora-mounted") === "true";
    console.error("[Global Error]", e.error ?? message);
    try {
      const w = window as unknown as { __plethoraTestErrors?: Array<{ type: string; message: string; stack?: string }> };
      w.__plethoraTestErrors = w.__plethoraTestErrors || [];
      w.__plethoraTestErrors.push({ type: "error", message: String(message), stack: e.error?.stack });
    } catch {}

    if (root && !isMounted) {
      const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      root.innerHTML = '<div style="padding:20px;background:#000;color:#fff;font-family:monospace;"><h2>Startup Error</h2><pre style="white-space:pre-wrap;">' + escapeHtml(e.message) + '\n' + escapeHtml(e.error?.stack || '') + '</pre></div>';
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message = reason?.message || String(reason);

    // Suppress Tauri v2 event plugin bug — same as the window.error handler above.
    // When unlisten() throws inside async code the TypeError surfaces here instead.
    if (message.includes("listeners[eventId].handlerId")) {
      event.preventDefault();
      return;
    }

    console.error("[Unhandled Rejection]", message);
    try {
      const w = window as unknown as { __plethoraTestErrors?: Array<{ type: string; message: string; stack?: string }> };
      w.__plethoraTestErrors = w.__plethoraTestErrors || [];
      w.__plethoraTestErrors.push({ type: "unhandledrejection", message, stack: reason?.stack });
    } catch {}
  });
}

import React, { lazy, Suspense, useEffect, useState } from "react";
import ReactDOM, { type Root } from "react-dom/client";
import { loadSelectedFonts } from "./utils/fonts";
import "./index.css";
import "./styles/mobile.css";
import { HashRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "./contexts/ThemeContext";
import { initializePWA } from "./lib/pwa";
import { isTauri } from "./lib/tauri";
import { installNetworkDebugInstrumentation, isNetworkDebugEnabled } from "./debug/networkDebug";
import { installConsoleLogcatBridge } from "./lib/consoleLogcatBridge";

const MainLayout = lazy(() => import("./components/layout/MainLayout").then(({ MainLayout: layout }) => ({ default: layout })));
const DevPerformanceMonitor = lazy(() => import("./components/common/PerformanceMonitor").then(({ DevPerformanceMonitor: monitor }) => ({ default: monitor })));
const Toast = lazy(() => import("./components/common/Toast").then(({ Toast: toast }) => ({ default: toast })));
const OnDeviceRunIndicator = lazy(() => import("./components/common/OnDeviceRunIndicator").then(({ OnDeviceRunIndicator: indicator }) => ({ default: indicator })));
const Modal = lazy(() => import("./components/common/Modal").then(({ Modal: modal }) => ({ default: modal })));
const KindleImportDialogHost = lazy(() => import("./components/import/KindleImportDialogHost").then(({ KindleImportDialogHost: host }) => ({ default: host })));
const StartupExperience = lazy(() => import("./components/startup/StartupExperience").then(({ StartupExperience: experience }) => ({ default: experience })));
const CompanionHost = lazy(() => import("./components/companion/CompanionHost"));
const Analytics = lazy(() => import("@vercel/analytics/react").then(({ Analytics: analytics }) => ({ default: analytics })));
import { BatteryProvider } from "./contexts/BatteryContext";
import { PresentationProvider } from "./contexts/PresentationContext";
import { LanguageProfileProvider } from "./contexts/LanguageProfileContext";
const AuthCallback = lazy(() => import("./routes/auth-callback").then(({ default: route }) => ({ default: route })));
const ScreenshotOverlay = lazy(() => import("./routes/screenshot-overlay").then(({ default: route }) => ({ default: route })));


function PageLoader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0a0a0a', color: '#fff' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 32, height: 32, border: '3px solid #333', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto' }}></div>
        <p style={{ marginTop: 16, fontSize: 14 }}>Loading...</p>
      </div>
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

/**
 * Startup overlay boundary: a startup animation failure must never take the
 * app down with it — the fallback is simply no overlay (openspec change
 * knowledge-peck-startup-animation, task 6.4).
 */
class StartupExperienceBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('[StartupExperience] overlay failed:', error);
  }

  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

/**
 * Cache keys for consistent query invalidation
 */
export const queryKeys = {
  queue: ["queue"] as const,
  queueStats: ["queue", "stats"] as const,
  documents: ["documents"] as const,
  document: (id: string) => ["documents", id] as const,
  extracts: (documentId: string) => ["extracts", documentId] as const,
  learningItems: (documentId: string) => ["learning-items", documentId] as const,
  /** Dictionary entries (`useDictionaryEntry`); staleTime Infinity — in-session repeats never refetch. */
  dictionary: (word: string) => ["dictionary", word] as const,
  review: ["review"] as const,
  analytics: (timeRange?: string) => ["analytics", timeRange] as const,
  categories: ["categories"] as const,
  settings: ["settings"] as const,
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 30,
      refetchOnWindowFocus: false,
      retry: 1,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
    mutations: {
      retry: 1,
    },
  },
});

// Error boundary for catching React errors
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Error objects stringify to `{}` in the Android log bridge. Include the
    // useful fields explicitly so release builds expose the actual render
    // failure instead of only the generic fallback screen.
    console.error('React error:', error?.message, error?.stack, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0a0a0a', color: '#fff', flexDirection: 'column' }}>
          <h1>Something went wrong</h1>
          <p style={{ color: '#f00' }}>{this.state.error?.message}</p>
          <pre style={{ background: '#111', padding: 16, borderRadius: 8, marginTop: 16, fontSize: 12 }}>{this.state.error?.stack?.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

if (isNetworkDebugEnabled()) {
  installNetworkDebugInstrumentation();
}

// Forward JS console.log/warn/error to the native logger (adb logcat on
// Android) so frontend output is visible in release mobile builds. Fire-and-
// forget; the bridge is a no-op off native mobile.
void installConsoleLogcatBridge();

// Initialize PWA (works in both Tauri and Web)
initializePWA();

// Dynamically load only the user's selected font from bundled @fontsource packages.
// Inter is imported statically as the critical default (see utils/fonts.ts).
try {
  const raw = migratedGetItem("plethora-settings");
  const parsed = raw ? JSON.parse(raw) : null;
  const fontFamily = parsed?.state?.settings?.appearance?.fontFamily;
  if (fontFamily && fontFamily !== "Inter" && fontFamily !== "system-ui" && fontFamily !== "serif" && fontFamily !== "sans-serif" && fontFamily !== "monospace") {
    void loadSelectedFonts([fontFamily]);
  }
} catch {
  // Settings not yet available or parse error — Inter is already loaded statically.
}

function runAfterFirstPaint(task: () => void, idleTimeout = 3000) {
  const scheduleIdle = () => {
    type IdleWindow = Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    };
    const win = window as IdleWindow;
    if (typeof win.requestIdleCallback === "function") {
      win.requestIdleCallback(task, { timeout: idleTimeout });
    } else {
      setTimeout(task, Math.min(idleTimeout, 1500));
    }
  };

  requestAnimationFrame(() => {
    requestAnimationFrame(scheduleIdle);
  });
}

// Mount React before optional startup integrations. These integrations are
// deliberately best-effort, but a synchronous Tauri/WebKit failure in one of
// them must never leave the static HTML boot frame on screen forever.
const rootEl = document.getElementById("root") as HTMLElement;
const bootstrapRoot = (window as Window & { __plethoraReactRoot?: Root }).__plethoraReactRoot;
const reactRoot = bootstrapRoot ?? ReactDOM.createRoot(rootEl);
if (!bootstrapRoot) {
  reactRoot.render(<PageLoader />);
  rootEl.setAttribute("data-plethora-mounted", "true");
}

// Expose the legacy debugging store registry without making every store part
// of the pre-mount module graph. Nothing in the first screen needs this
// registry; populate it after the first paint and keep the public shape intact.
if (typeof window !== "undefined") {
  (window as unknown as { plethora: { stores: Record<string, unknown> } }).plethora = { stores: {} };
  runAfterFirstPaint(() => {
    import("./stores")
      .then((stores) => {
        (window as unknown as { plethora: { stores: Record<string, unknown> } }).plethora.stores = {
          paywall: stores.usePaywallStore,
          sync: stores.useSyncStore,
          billing: stores.useBillingStore,
          entitlements: stores.useEntitlementStore,
          account: stores.useAccountStore,
          inbox: stores.useInboxStore,
          learningPaths: stores.useLearningPathsStore,
          knowledgeHealth: stores.useKnowledgeHealthStore,
          apiTokens: stores.useApiTokensStore,
          cardOptimizer: stores.useCardOptimizerStore,
          knowledgeGaps: stores.useKnowledgeGapsStore,
        };
      })
      .catch((error) => console.error("[main.tsx] Failed to populate store registry:", error));
  });
}

// The browser-extension server runs in Rust, while the current AI settings UI
// is backed by the persisted LLM provider registry in the WebView. Bridge the
// selected provider after hydration on every native startup so HTTP AI routes
// see exactly the same provider as the desktop assistant.
if (isTauri()) {
  runAfterFirstPaint(() => {
    import("./stores/llmProvidersStore")
      .then(({ syncPrimaryProviderToNativeAI, useLLMProvidersStore }) =>
        syncPrimaryProviderToNativeAI(useLLMProvidersStore.getState().providers),
      )
      .catch((error) => {
        console.error("[main.tsx] Failed to synchronize native AI provider:", error);
      });
  });
}

// Keep the in-app reminder alive on every surface. The scheduler is deliberately
// deferred until after the first paint so local boot remains responsive.
runAfterFirstPaint(() => {
  import("./lib/feedback/reminderScheduler")
    .then(({ startReminderScheduler }) => startReminderScheduler())
    .catch((error) => console.error("[feedback] scheduler failed to load:", error));
});

// Background Rust transcription flows cannot read WebView localStorage. Keep a
// secret-free mirror of the selected provider/model/language in app_settings,
// but do not let this optional bridge delay the first interactive render.
runAfterFirstPaint(() => {
  import("./lib/transcriptionConfigMirror")
    .then(({ startTranscriptionConfigMirror }) => startTranscriptionConfigMirror())
    .catch((error) => console.error("[transcription] config mirror failed to load:", error));
});

// Billing provider selection at startup (openspec change
// implement-native-ios-storekit2-billing §3.4): iOS → AppStoreBillingProvider
// (native StoreKit 2); other platforms → dev-only mock. Also performs relaunch
// reconciliation of any pending transaction JWS payloads.
runAfterFirstPaint(() => {
  import("./stores/billingStore")
    .then(({ useBillingStore }) => useBillingStore.getState().init())
    .catch((error) => console.error('[billing] startup init failed:', error));
});

// One-time removal of real-time-sync residue (y-indexeddb databases, stale
// localStorage keys) on installs that predate the sync removal.
runAfterFirstPaint(() => {
  import("./lib/syncResidueCleanup").then(({ runSyncResidueCleanup }) =>
    runSyncResidueCleanup(),
  );
});

// Idempotent legacy-audiobook → Audio Edition migration (openspec change
// add-audio-editions-and-hands-free-study-mode, task 1.5). Guarded by a
// localStorage completion flag plus per-document edition checks, so repeated
// startups are cheap no-ops.
runAfterFirstPaint(() => {
  import("./utils/audioEditionMigration")
    .then(({ runLegacyAudiobookMigration }) => runLegacyAudiobookMigration())
    .then(({ migratedCount }) => {
      if (migratedCount > 0) {
        console.log(`[AudioEdition] Migrated ${migratedCount} legacy audiobook(s).`);
      }
    })
    .catch((error) => {
      console.warn("[AudioEdition] Legacy audiobook migration failed:", error);
    });
});

// Dev/Tauri: ensure no service worker or cache is present to avoid stale assets.
if ((import.meta.env.DEV || isTauri()) && "serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => registration.unregister());
  }).catch(() => {});
}

if ((import.meta.env.DEV || isTauri()) && "caches" in window) {
  caches.keys().then((keys) => {
    keys.forEach((key) => caches.delete(key));
  });
}

// Initialize demo content for web/PWA (only in browser mode, not Tauri)
if (!isTauri()) {
  import('./lib/demoContent').then(({ checkAndImportDemoContent }) => {
    checkAndImportDemoContent(null, null).catch((error) => {
      console.error('[Demo Content] Auto-import check failed or skipped:', error);
    });
  }).catch(() => {
    // Module may not be available in all build configurations
  });

  import('./lib/extension-bridge').then(({ initExtensionBridge }) => {
    initExtensionBridge();
  }).catch((error) => {
    console.error('[Extension Bridge] Module not available:', error);
  });
}

// Cross-surface tag reconciliation: after a successful tag mutation anywhere,
// mounted document/extract/queue consumers merge the persisted tag list in
// place (no full reload). See openspec change
// unify-tag-editing-and-align-schedule-grid, task 2.3.
import('./lib/tagEditing/storeReconciliation')
  .then(({ wireTagUpdateReconciliation }) => {
    wireTagUpdateReconciliation();
  })
  .catch((error) => {
    console.error('[Tag Editing] Reconciliation wiring failed:', error);
  });

// Paid-operation consent handler (ai-billing-safety #14): surfaces the opt-in
// modal whenever a billable embedding/TTS operation is attempted while the
// relevant consent flag is off. The <Modal /> host below renders the dialog.
import('./lib/paidConsent/registerPaidConsentHandler')
  .then(({ registerPaidConsentHandler }) => {
    registerPaidConsentHandler();
  })
  .catch((error) => {
    console.error('[Paid Consent] Handler registration failed:', error);
  });

// Cloud-AI first-use disclosure presenter (Change C §4): the modal shown once
// per provider class before content is sent to a cloud AI provider. The gate
// (src/lib/privacy/cloudAiDisclosure.ts) consults it at every cloud-AI entry
// point; without this registration headless contexts proceed un-persisted.
import('./lib/privacy/cloudAiDisclosureUi')
  .then(({ defaultCloudAiDisclosurePresenter }) => {
    return import('./lib/privacy/cloudAiDisclosure').then(
      ({ setCloudAiDisclosurePresenter }) => {
        setCloudAiDisclosurePresenter(defaultCloudAiDisclosurePresenter);
      }
    );
  })
  .catch((error) => {
    console.error('[Cloud AI Disclosure] Presenter registration failed:', error);
  });

// Memory benchmark harness (bound-runtime-memory-and-gate): drives the app
// through a deterministic scenario when the harness env vars are present.
// Inert in any other configuration (the backend command returns null).
if (isTauri()) {
  import('./lib/memoryScenario/host')
    .then(({ startMemoryScenario }) => {
      void startMemoryScenario();
    })
    .catch((error) => {
      console.error('[Memory Scenario] Host failed to start:', error);
    });
}

reactRoot.render(
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <PresentationProvider>
        <LanguageProfileProvider>
        <ThemeProvider>
          <BatteryProvider>
          <HashRouter>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                {/* OAuth callback route - must be before catch-all */}
                <Route path="/auth/callback" element={<AuthCallback />} />
                <Route path="/screenshot-overlay" element={<ScreenshotOverlay />} />
                {/* Catch-all route - MainLayout handles tab-based navigation internally */}
                <Route path="*" element={<MainLayout />} />
              </Routes>
            </Suspense>
            <Suspense fallback={null}>
              <DevPerformanceMonitor />
              <Toast />
              {/* Optional ambient mascot companion — lazily loaded, renders
                  nothing unless the user enables it (Settings → Appearance). */}
              <CompanionHost />
              {/* Chunk progress + cancel for long on-device AI runs (Android). */}
              <OnDeviceRunIndicator />
              <Modal />
              {/* Global Kindle clippings dialog — opened from any import entry
                  point (drag & drop, file picker, folder import, paste) via
                  openKindleImportDialog(path). See kindleImportDialogStore. */}
              <KindleImportDialogHost />
            </Suspense>
            {/* Only load Vercel Analytics in web/PWA mode, not in Tauri desktop */}
            {!isTauri() && <Analytics />}
            {/* Knowledge Peck branded startup overlay (openspec change
                knowledge-peck-startup-animation). Statically imported — it
                must render before lazy routes resolve — and mounted as the
                last child so it covers boot above the app (z 9000). Arms
                only on a genuine main-window launch; see
                src/lib/startupAnimation/store.ts. */}
            <Suspense fallback={null}>
              <StartupExperienceBoundary>
                <StartupExperience />
              </StartupExperienceBoundary>
            </Suspense>
          </HashRouter>
          </BatteryProvider>
        </ThemeProvider>
        </LanguageProfileProvider>
      </PresentationProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

if (typeof document !== "undefined") {
  document.body.setAttribute("data-plethora-ready", "true");
  console.log("[startup] plethora-ready: true (React mounted)");
  if (isTauri()) {
    import("@tauri-apps/api/core")
      .then(({ invoke }) => {
        invoke("ping_health").catch((e) => {
          console.warn("[startup] ping_health failed:", e);
        });
      })
      .catch(() => {});
  }
  let mainHeartbeat = 0;
  window.setInterval(() => {
    mainHeartbeat++;
    document.body.setAttribute("data-plethora-heartbeat", String(mainHeartbeat));
  }, 1000);
}
