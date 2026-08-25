/**
 * Harness-visible logging (shared by the host and executor): console AND
 * the native logger (Stdout target on desktop). A failed overnight soak must
 * name the JS-side cause in the driver's captured output (D10 failed-run
 * artifacts) — console alone is invisible in a desktop WKWebView.
 */

import { info as nativeLogInfo, warn as nativeLogWarn } from "@tauri-apps/plugin-log";

export function harnessLog(message: string, kind: "info" | "warn" = "info"): void {
  if (kind === "warn") {
    console.warn(message);
    void nativeLogWarn(message).catch(() => {});
  } else {
    console.log(message);
    void nativeLogInfo(message).catch(() => {});
  }
}
