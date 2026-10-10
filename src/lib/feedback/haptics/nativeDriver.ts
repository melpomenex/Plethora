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
  private configured = false;

  constructor(
    private readonly driverKind: "android-native" | "ios-native",
    private readonly invoke: Invoke = tauriInvoke,
  ) {}

  private call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    // A missing native completion must not poison configuration or occupy the
    // service's single perform slot forever. No effect is retried or replayed.
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("native haptics command timed out")), 2_000);
      Promise.resolve().then(() => this.invoke<T>(command, args)).then(resolve, reject)
        .finally(() => clearTimeout(timer));
    });
  }

  getCachedCapabilities(): HapticCapabilities | null { return this.capabilities; }

  async getCapabilities(): Promise<HapticCapabilities> {
    const caps = await this.call<HapticCapabilities>("plugin:plethora-haptics|get_capabilities");
    if (caps.protocolVersion !== 1 || caps.driver !== this.driverKind || !caps.driverSessionId || !Number.isSafeInteger(caps.configurationRevision) || caps.configurationRevision < 0) {
      throw new Error("native haptics protocol mismatch");
    }
    this.capabilities = caps;
    return caps;
  }

  configure(enabled: boolean, intensity: HapticIntensity): Promise<boolean> {
    this.configured = false;
    let result = false;
    const operation = this.configurationSequence.then(async () => {
      const caps = await this.getCapabilities();
      const config: HapticConfiguration = {
        driverSessionId: caps.driverSessionId,
        revision: caps.configurationRevision + 1,
        enabled,
        intensity,
      };
      const applied = await this.call<{ driverSessionId: string; revision: number }>(
        "plugin:plethora-haptics|configure",
        { config },
      );
      result = applied.driverSessionId === config.driverSessionId && applied.revision === config.revision;
      this.configured = result;
      if (result && this.capabilities) {
        this.capabilities = {
          ...this.capabilities,
          configurationRevision: applied.revision,
          ...(this.capabilities.nativeState ? { nativeState: { ...this.capabilities.nativeState, configured: true } } : {}),
        };
      }
    });
    this.configurationSequence = operation.then(() => undefined, () => undefined);
    return operation.then(() => result);
  }

  async perform(effect: HapticEffect, interactionId: string, ttlMs: number): Promise<NativeHapticResult> {
    const caps = this.capabilities;
    if (!caps || !this.configured) return { status: "skipped", reason: "stale" };
    if (caps.hardware !== "available") return { status: "skipped", reason: "unsupported" };
    const request: NativeHapticRequest = {
      driverSessionId: caps.driverSessionId,
      revision: caps.configurationRevision,
      interactionId,
      effect,
      ttlMs: Math.max(1, Math.min(150, Math.floor(ttlMs))),
    };
    return this.call("plugin:plethora-haptics|perform", { request });
  }
}
