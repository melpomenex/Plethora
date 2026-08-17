/**
 * Notification Service
 * Handles notifications for both PWA (Web Notifications API) and Tauri (native notifications)
 */

import { isTauri, invokeCommand } from "../lib/tauri";
import { migratedGetItem } from "../lib/brandMigration";
import { playNotificationSound as _playNotificationSound } from "./soundService";

export type NotificationPermission = "granted" | "denied" | "default";

export interface NotificationOptions {
  title: string;
  body?: string;
  icon?: string;
  badge?: string;
  tag?: string;
  requireInteraction?: boolean;
  silent?: boolean;
  data?: Record<string, unknown>;
  actions?: NotificationAction[];
}

export interface NotificationAction {
  action: string;
  title: string;
  icon?: string;
}

export interface ScheduledNotification {
  id: string;
  options: NotificationOptions;
  timestamp: number;
  repeat?: "daily" | "weekly" | "none";
}

// In-memory store for scheduled notifications (until service worker handles them)
let scheduledNotifications: ScheduledNotification[] = [];

/**
 * Check if notifications are supported
 */
export function areNotificationsSupported(): boolean {
  if (isTauri()) {
    return true; // Tauri supports notifications via plugin
  }
  return "Notification" in window;
}

/**
 * Check current notification permission status
 */
export async function checkNotificationPermission(): Promise<NotificationPermission> {
  if (isTauri()) {
    try {
      // Use Tauri command to check permission
      const result = await invokeCommand<{ granted: boolean }>(
        "check_notification_permission"
      );
      return result.granted ? "granted" : "default";
    } catch {
      return "default";
    }
  }

  if (!("Notification" in window)) {
    return "denied";
  }

  return window.Notification.permission as NotificationPermission;
}

/**
 * Request notification permission
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (isTauri()) {
    try {
      // Use Tauri command to request permission
      const result = await invokeCommand<{ granted: boolean }>(
        "request_notification_permission"
      );
      return result.granted ? "granted" : "denied";
    } catch (error) {
      console.error("Failed to request Tauri notification permission:", error);
      return "denied";
    }
  }

  if (!("Notification" in window)) {
    return "denied";
  }

  try {
    const permission = await window.Notification.requestPermission();
    return permission as NotificationPermission;
  } catch (error) {
    console.error("Failed to request notification permission:", error);
    return "denied";
  }
}

/**
 * Send a notification immediately
 */
export async function sendNotification(
  options: NotificationOptions
): Promise<boolean> {
  const permission = await checkNotificationPermission();
  if (permission !== "granted") {
    console.warn("Notification permission not granted");
    return false;
  }

  if (isInQuietHours()) {
    return false;
  }

  if (isTauri()) {
    return sendTauriNotification(options);
  } else {
    return sendWebNotification(options);
  }
}

/**
 * Send notification via Tauri
 */
async function sendTauriNotification(
  options: NotificationOptions
): Promise<boolean> {
  try {
    // Use Tauri command to send notification
    await invokeCommand("send_notification", {
      notification: {
        id: generateId(),
        notification_type: "Custom",
        title: options.title,
        body: options.body || "",
        priority: "Normal",
        icon: options.icon,
        image: null,
        action: options.data?.url ? `plethora://${options.data.url}` : null,
        created_at: new Date().toISOString(),
        read: false,
        ttl: 3600,
      },
    });

    // Play sound if enabled
    if (!options.silent) {
      playNotificationSound();
    }

    return true;
  } catch (error) {
    console.error("Failed to send Tauri notification:", error);
    return false;
  }
}

/**
 * Send notification via Web Notifications API
 */
async function sendWebNotification(
  options: NotificationOptions
): Promise<boolean> {
  try {
    // Check if service worker is available for better notification handling
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      // Use service worker to show notification
      navigator.serviceWorker.controller.postMessage({
        type: "SHOW_NOTIFICATION",
        payload: options,
      });
      return true;
    }

    // Fallback to standard Notification API
    const notification = new window.Notification(options.title, {
      body: options.body,
      icon: options.icon,
      badge: options.badge,
      tag: options.tag,
      requireInteraction: options.requireInteraction,
      silent: options.silent,
      data: options.data,
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };

    // Play sound if enabled
    if (!options.silent) {
      playNotificationSound();
    }

    return true;
  } catch (error) {
    console.error("Failed to send web notification:", error);
    return false;
  }
}

/**
 * Schedule a notification for later
 */
export async function scheduleNotification(
  options: NotificationOptions,
  delayMs: number = 0
): Promise<boolean> {
  const permission = await checkNotificationPermission();
  if (permission !== "granted") {
    return false;
  }

  if (delayMs <= 0) {
    // Send immediately
    return sendNotification(options);
  }

  // Store for later
  const scheduled: ScheduledNotification = {
    id: generateId(),
    options,
    timestamp: Date.now() + delayMs,
  };

  scheduledNotifications.push(scheduled);

  // Set timeout to trigger
  setTimeout(() => {
    sendNotification(options);
    scheduledNotifications = scheduledNotifications.filter(
      (n) => n.id !== scheduled.id
    );
  }, delayMs);

  return true;
}

/**
 * Cancel a scheduled notification
 */
export function cancelScheduledNotification(id: string): boolean {
  const initialLength = scheduledNotifications.length;
  scheduledNotifications = scheduledNotifications.filter((n) => n.id !== id);
  return scheduledNotifications.length < initialLength;
}

/**
 * Cancel all scheduled notifications
 */
export function cancelAllNotifications(): void {
  scheduledNotifications = [];
}

/**
 * Get all scheduled notifications
 */
export function getScheduledNotifications(): ScheduledNotification[] {
  return [...scheduledNotifications];
}

/**
 * Check if currently in quiet hours
 */
function isInQuietHours(): boolean {
  // Get quiet hours from settings (stored in localStorage for simplicity)
  const settings = migratedGetItem("plethora-settings");
  if (!settings) return false;

  try {
    const parsed = JSON.parse(settings);
    const { notifications } = parsed.state?.settings || {};

    if (!notifications?.quietHoursEnabled) return false;

    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTime = currentHour * 60 + currentMinute;

    const [startHour, startMinute] = (notifications.quietHoursStart || "22:00")
      .split(":")
      .map(Number);
    const [endHour, endMinute] = (notifications.quietHoursEnd || "08:00")
      .split(":")
      .map(Number);

    const startTime = startHour * 60 + startMinute;
    const endTime = endHour * 60 + endMinute;

    if (startTime < endTime) {
      // Same day (e.g., 9 AM to 5 PM)
      return currentTime >= startTime && currentTime < endTime;
    } else {
      // Overnight (e.g., 10 PM to 8 AM)
      return currentTime >= startTime || currentTime < endTime;
    }
  } catch {
    return false;
  }
}

/**
 * Play notification sound
 */
function playNotificationSound(): void {
  _playNotificationSound();
}

/**
 * Update app badge count (for PWA)
 */
export async function updateBadgeCount(count: number): Promise<void> {
  if (isTauri()) {
    // Tauri doesn't support badge count directly, but we could use the tray icon
    return;
  }

  // Use Badging API for PWA
  if ("setAppBadge" in navigator) {
    try {
      if (count > 0) {
        await (navigator as any).setAppBadge(count);
      } else {
        await (navigator as any).clearAppBadge();
      }
    } catch (error) {
      console.error("Failed to update badge:", error);
    }
  }
}

/**
 * Clear app badge
 */
export async function clearBadge(): Promise<void> {
  if ("clearAppBadge" in navigator) {
    try {
      await (navigator as any).clearAppBadge();
    } catch (error) {
      console.error("Failed to clear badge:", error);
    }
  }
}

/**
 * Generate unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * @deprecated Use `startReminderScheduler` from `src/lib/feedback`.
 * Reminder scheduling now reads the Zustand settings slice and routes delivery
 * through the unified feedback orchestrator.
 */
export function initializeNotifications(): void {
  // Kept as a no-op compatibility export for integrations that still import it.
}
