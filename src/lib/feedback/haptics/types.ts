export const HAPTIC_EFFECTS = [
  "selection",
  "activation",
  "threshold",
  "commit",
  "success",
  "warning",
  "error",
  "completion",
  "celebration",
] as const;

export type HapticEffect = (typeof HAPTIC_EFFECTS)[number];
export type HapticIntensity = "subtle" | "standard" | "strong";
export type HapticSupport = "available" | "unavailable" | "unknown";
export type HapticDriver = "android-native" | "ios-native" | "browser" | "none";
export type HapticSystemPreference = "enabled" | "disabled" | "unknown";
export type HapticIntensityControl = "effect-style" | "fixed" | "none";

export interface HapticCapabilities {
  protocolVersion: 1;
  driver: HapticDriver;
  driverSessionId: string;
  configurationRevision: number;
  hardware: HapticSupport;
  systemPreference: HapticSystemPreference;
  intensityControl: HapticIntensityControl;
  nativeState?: {
    foreground: boolean;
    webViewAttached: boolean;
    webViewVisible: boolean;
    viewHapticsEnabled: boolean;
    configured: boolean;
  };
}

export interface HapticConfiguration {
  driverSessionId: string;
  revision: number;
  enabled: boolean;
  intensity: HapticIntensity;
}

export interface NativeHapticRequest {
  driverSessionId: string;
  revision: number;
  interactionId: string;
  effect: HapticEffect;
  ttlMs: number;
}

export type NativeHapticResult =
  | { status: "submitted"; nativeState?: NativeHapticDeliveryState }
  | {
      status: "skipped";
      reason?: "unsupported" | "disabled" | "background" | "stale" | "rate-limited" | "system-suppressed";
      nativeState?: NativeHapticDeliveryState;
    };

export interface NativeHapticDeliveryState {
  hapticFeedbackConstant: number;
  platformAccepted: boolean;
}

export interface HapticsSettings {
  enabled: boolean;
  intensity: HapticIntensity;
}

export const DEFAULT_HAPTICS_SETTINGS: HapticsSettings = {
  enabled: true,
  intensity: "subtle",
};

export function isHapticIntensity(value: unknown): value is HapticIntensity {
  return value === "subtle" || value === "standard" || value === "strong";
}
