import type {
  HapticCapabilities,
  HapticConfiguration,
  HapticEffect,
  HapticIntensity,
  NativeHapticRequest,
  NativeHapticResult,
} from "./types";
import type { HapticsDriver } from "./noopDriver";

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

async function tauriInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export class NativeHapticsDriver implements HapticsDriver {
  private capabilities: HapticCapabilities | null = null;
  private configurationSequence: Promise<void> = Promise.resolve();

  constructor(
    private readonly driverKind: "android-native" | "ios-native",
    private readonly invoke: Invoke = tauriInvoke,
  ) {}

  async getCapabilities(): Promise<HapticCapabilities> {
    const caps = await this.invoke<HapticCapabilities>("plugin:plethora-haptics|get_capabilities");
    if (caps.protocolVersion !== 1 || caps.driver !== this.driverKind || !caps.driverSessionId) {
      throw new Error("native haptics protocol mismatch");
    }
    this.capabilities = caps;
    return caps;
  }

  configure(enabled: boolean, intensity: HapticIntensity): Promise<boolean> {
    let result = false;
    const operation = this.configurationSequence.then(async () => {
      const caps = await this.getCapabilities();
      const config: HapticConfiguration = {
        driverSessionId: caps.driverSessionId,
        revision: caps.configurationRevision + 1,
        enabled,
        intensity,
      };
      const applied = await this.invoke<{ driverSessionId: string; revision: number }>(
        "plugin:plethora-haptics|configure",
        { config },
      );
      result = applied.driverSessionId === config.driverSessionId && applied.revision === config.revision;
      if (result && this.capabilities) {
        this.capabilities = { ...this.capabilities, configurationRevision: applied.revision };
      }
    });
    this.configurationSequence = operation.then(() => undefined, () => undefined);
    return operation.then(() => result);
  }

  async perform(effect: HapticEffect, interactionId: string, ttlMs: number): Promise<NativeHapticResult> {
    const caps = this.capabilities;
    if (!caps) return { status: "skipped", reason: "stale" };
    if (caps.hardware !== "available") return { status: "skipped", reason: "unsupported" };
    const request: NativeHapticRequest = {
      driverSessionId: caps.driverSessionId,
      revision: caps.configurationRevision,
      interactionId,
      effect,
      ttlMs: Math.max(1, Math.min(150, Math.floor(ttlMs))),
    };
    return this.invoke("plugin:plethora-haptics|perform", { request });
  }
}
