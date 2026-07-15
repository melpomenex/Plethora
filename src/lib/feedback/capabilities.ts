/**
 * Platform capability boundary for the feedback system.
 *
 * Scaffolding for the `unify-notifications-and-sound` OpenSpec change.
 * The synchronous surface classification below is real and safe to use; the
 * async permission/capability queries are TODO(implementation) (tasks.md 1.3)
 * and intentionally not stubbed with fake values — implementers fill
 * `queryAsyncCapabilities` using the existing helpers referenced in its doc.
 *
 * Rule: the orchestrator consults capabilities; call sites never do.
 */

import { isNativeMobile, isPWA, isTauri } from "../tauri";
import {
  areNotificationsSupported,
  checkNotificationPermission,
} from "../../utils/notificationService";
import { isPeriodicSyncSupported } from "../../utils/pushSubscription";
import { supportsHaptics } from "../../utils/soundService";

/** Where the app is running, for policy decisions. */
export type FeedbackSurface =
  | "tauri-desktop"
  | "tauri-mobile"
  | "installed-pwa"
  | "browser";

/**
 * Async capabilities the orchestrator needs before delivering to a channel.
 * Populated by queryAsyncCapabilities (TODO(implementation), task 1.3):
 * - notificationPermission → checkNotificationPermission() in
 *   src/utils/notificationService.ts (Tauri command or Web Notification API)
 * - periodicSyncAvailable  → isPeriodicSyncSupported() in
 *   src/utils/pushSubscription.ts
 * - badgeAvailable         → "setAppBadge" in navigator
 * - hapticsAvailable       → supportsHaptics() in src/utils/soundService.ts
 */
export interface AsyncFeedbackCapabilities {
  notificationPermission: "granted" | "denied" | "default" | "unsupported";
  periodicSyncAvailable: boolean;
  badgeAvailable: boolean;
  hapticsAvailable: boolean;
}

/**
 * Synchronous, dependency-free surface classification composed from the
 * existing lib/tauri helpers. Order matters: native checks win over PWA
 * (a Tauri webview can report standalone display-mode).
 */
export function detectFeedbackSurface(): FeedbackSurface {
  if (isTauri()) {
    return isNativeMobile() ? "tauri-mobile" : "tauri-desktop";
  }
  if (isPWA()) {
    return "installed-pwa";
  }
  return "browser";
}

/**
 * Query the platform-dependent capabilities used by the feedback resolver.
 * Every helper is isolated so a missing browser API or a failed native query
 * degrades to an explicit unsupported/false result instead of interrupting
 * feedback delivery.
 */
export type QueryAsyncCapabilities = () => Promise<AsyncFeedbackCapabilities>;

async function queryNotificationPermission(): Promise<AsyncFeedbackCapabilities["notificationPermission"]> {
  try {
    if (!areNotificationsSupported()) return "unsupported";

    const permission = await checkNotificationPermission();
    if (permission === "granted" || permission === "denied" || permission === "default") {
      return permission;
    }
  } catch {
    // Permission checks are best-effort. The settings surface remains the
    // place where a user can retry or recover a permission state.
  }

  return "unsupported";
}

export const queryAsyncCapabilities: QueryAsyncCapabilities = async () => {
  const [notificationPermission, periodicSyncAvailable, hapticsAvailable] = await Promise.all([
    queryNotificationPermission(),
    Promise.resolve().then(() => {
      try {
        return isPeriodicSyncSupported();
      } catch {
        return false;
      }
    }),
    Promise.resolve().then(() => {
      try {
        return supportsHaptics();
      } catch {
        return false;
      }
    }),
  ]);

  let badgeAvailable = false;
  try {
    badgeAvailable = typeof navigator !== "undefined" && "setAppBadge" in navigator;
  } catch {
    badgeAvailable = false;
  }

  return {
    notificationPermission,
    periodicSyncAvailable,
    badgeAvailable,
    hapticsAvailable,
  };
};
