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
import { ANDROID_STARTUP_TRACE_PREFIX } from "./startupDiagnostics";

const installed = Symbol("plethora.consoleLogcatBridge.installed");
let installing: Promise<boolean> | undefined;

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
  if (installing) return installing;
  installing = installForwarder(c).finally(() => { installing = undefined; });
  return installing;
}

async function installForwarder(c: ConsoleWithFlag): Promise<boolean> {
  // Lazy-import so desktop builds never pull the plugin into the bundle.
  const log = await import("@tauri-apps/plugin-log");

  let pending = false;
  const forward =
    (level: "debug" | "info" | "warn" | "error", original: (...args: unknown[]) => void) =>
    (...args: unknown[]) => {
      try {
        original(...args);
        // A hung invoke retains at most one request, with no queue. Startup
        // traces have their own native console channel and never re-enter IPC.
        if (pending || String(args[0]).startsWith(ANDROID_STARTUP_TRACE_PREFIX)) return;
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
          .join(" ").slice(0, 4096);
        // Fire-and-forget; never await on the logging hot path.
        pending = true;
        void log[level](text).catch(() => {}).finally(() => { pending = false; });
      } catch {
        pending = false;
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

  console.log = forward("info", orig.log);
  console.info = forward("info", orig.info);
  console.warn = forward("warn", orig.warn);
  console.error = forward("error", orig.error);
  console.debug = forward("debug", orig.debug);

  // Keep a reference for debugging / teardown if ever needed.
  (console as ConsoleWithFlag & { __plethoraOrigConsole?: typeof orig }).__plethoraOrigConsole = orig;
  c[installed] = true;

  // Emit a marker so it's easy to confirm the bridge is live in logcat.
  console.info("[consoleLogcatBridge] installed");

  return true;
}
