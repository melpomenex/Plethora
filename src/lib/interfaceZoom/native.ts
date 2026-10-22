/**
 * Native interface-zoom application (change: desktop-global-interface-zoom).
 *
 * The only module that talks to Tauri's WebView page-zoom API. The capability
 * is desktop-only, scoped to the `main` webview, and gated here so the rest of
 * the feature can stay platform-agnostic and inert on browser/mobile.
 */

import { isMac, isNativeMobile, isTauri } from "../tauri";
import { version as osVersion } from "@tauri-apps/plugin-os";

/** The only webview that owns the application shell. */
const MAIN_WEBVIEW_LABEL = "main";

/** Minimum macOS version whose WKWebView exposes `pageZoom`. */
const MACOS_MINIMUM_SUPPORTED_MAJOR = 11;

function readMacOsMajorVersion(): number | null {
  try {
    const raw = osVersion();
    const major = Number.parseInt(String(raw ?? "").split(".")[0], 10);
    return Number.isFinite(major) ? major : null;
  } catch {
    return null;
  }
}

/**
 * Whether this runtime can apply native interface zoom. Synchronous and safe
 * during module evaluation: returns false for browser/PWA, native mobile, and
 * macOS older than 11 (or macOS whose version cannot be read).
 */
export function isDesktopInterfaceZoomSupported(): boolean {
  try {
    if (!isTauri() || isNativeMobile()) return false;
    if (isMac()) {
      const major = readMacOsMajorVersion();
      return major !== null && major >= MACOS_MINIMUM_SUPPORTED_MAJOR;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Apply a percentage to the main webview with native page zoom. Rejections
 * propagate so the controller can roll back; auxiliary webviews are a no-op.
 */
export async function applyNativeInterfaceZoom(percent: number): Promise<void> {
  // Unsupported runtimes stay inert: never import or invoke the native API.
  if (!isDesktopInterfaceZoomSupported()) return;
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  const webview = getCurrentWebview();
  if (webview.label !== MAIN_WEBVIEW_LABEL) return;
  await webview.setZoom(percent / 100);
}
