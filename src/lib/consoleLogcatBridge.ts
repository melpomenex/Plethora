/**
 * consoleLogcatBridge
 *
 * Forwards frontend `console.log/warn/error/debug/info` to the native logger
 * (tauri-plugin-log), so JS output appears in `adb logcat` on Android release
 * builds. Without this, JS console output is invisible on a release build —
 * which makes diagnosing mobile lag/heating effectively blind on the JS side.
 *
 * Only installed inside native mobile (Android/iOS) builds, since desktop/dev
 * already shows console output in the terminal/DevTools and we don't want to
 * double-log or pay the IPC cost there.
 *
 * The bridge preserves original console behavior (still prints to the real
 * console) and is defensive: any failure to forward is swallowed so it can
 * never break app logging or throw on the logging hot path.
 */

import { isNativeMobile } from "./tauri";

const installed = Symbol("incrementum.consoleLogcatBridge.installed");

interface ConsoleWithFlag extends Console {
  [installed]?: boolean;
}

/**
 * Install the console → native-log forwarder. Safe to call once at startup.
 * Returns true if installed, false if skipped (non-mobile or already installed).
 */
export async function installConsoleLogcatBridge(): Promise<boolean> {
  if (!isNativeMobile()) return false;
  const c = console as ConsoleWithFlag;
  if (c[installed]) return false;

  // Lazy-import so desktop builds never pull the plugin into the bundle.
  const log = await import("@tauri-apps/plugin-log");

  const forward =
    (level: "trace" | "debug" | "info" | "warn" | "error") =>
    (...args: unknown[]) => {
      try {
        // Coerce args to a single string. Objects are JSON-encoded when safe;
        // unstringifiable values fall back to String().
        const text = args
          .map((a) => {
            if (typeof a === "string") return a;
            try {
              return JSON.stringify(a);
            } catch {
              return String(a);
            }
          })
          .join(" ");
        // Fire-and-forget; never await on the logging hot path.
        void log[level](text).catch(() => {});
      } catch {
        // Swallow — logging must never throw.
      }
    };

  const orig = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
  };

  console.log = forward("info");
  console.info = forward("info");
  console.warn = forward("warn");
  console.error = forward("error");
  console.debug = forward("debug");

  // Keep a reference for debugging / teardown if ever needed.
  (console as ConsoleWithFlag & { __incrementumOrigConsole?: typeof orig }).__incrementumOrigConsole = orig;
  c[installed] = true;

  // Emit a marker so it's easy to confirm the bridge is live in logcat.
  try {
    await log.info("[consoleLogcatBridge] installed — JS console now forwarding to logcat");
  } catch {
    /* ignore */
  }

  return true;
}
