import type { HapticCapabilities, HapticEffect, HapticIntensity, NativeHapticResult } from "./types";

export interface HapticsDriver {
  getCapabilities(): Promise<HapticCapabilities>;
  configure(enabled: boolean, intensity: HapticIntensity): Promise<boolean>;
  perform(effect: HapticEffect, interactionId: string, ttlMs: number): Promise<NativeHapticResult>;
}

export class NoopHapticsDriver implements HapticsDriver {
  async getCapabilities(): Promise<HapticCapabilities> {
    return {
      protocolVersion: 1,
      driver: "none",
      driverSessionId: "none",
      configurationRevision: 0,
      hardware: "unavailable",
      systemPreference: "unknown",
      intensityControl: "none",
    };
  }

  async configure(_enabled: boolean, _intensity: HapticIntensity): Promise<boolean> { return false; }
  async perform(_effect: HapticEffect, _interactionId: string, _ttlMs: number): Promise<NativeHapticResult> {
    return { status: "skipped", reason: "unsupported" };
  }
}
