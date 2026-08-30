import { isNativeMobile, isTauri } from "../../lib/tauri";

export type PerformanceClass = "excellent" | "good" | "usable" | "slow" | "unsupported";

const CLASS_RANK: Record<PerformanceClass, number> = {
  excellent: 4,
  good: 3,
  usable: 2,
  slow: 1,
  unsupported: 0,
};

export interface DeviceCapabilitySnapshot {
  performanceClass: PerformanceClass;
  hardwareConcurrency: number;
  deviceMemoryGb: number | null;
  isTauri: boolean;
  isNativeMobile: boolean;
  canRunLocalNemotron: boolean;
}

export interface MobileNemotronInstallRecommendation {
  allowed: boolean;
  warning?: string;
  performanceClass: PerformanceClass;
}

function readDeviceMemoryGb(): number | null {
  if (typeof navigator === "undefined") return null;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof memory === "number" && Number.isFinite(memory) ? memory : null;
}

function readHardwareConcurrency(): number {
  if (typeof navigator === "undefined") return 2;
  const cores = navigator.hardwareConcurrency;
  return typeof cores === "number" && cores > 0 ? cores : 2;
}

function meetsMinimum(actual: PerformanceClass, minimum: PerformanceClass): boolean {
  return CLASS_RANK[actual] >= CLASS_RANK[minimum];
}

/**
 * Classify device performance for local Nemotron ASR using coarse browser hints.
 * Conservative when `deviceMemory` is unavailable.
 */
export function classifyDevice(): PerformanceClass {
  if (!isTauri()) {
    return "unsupported";
  }

  const cores = readHardwareConcurrency();
  const memoryGb = readDeviceMemoryGb();
  const mobile = isNativeMobile();

  if (mobile) {
    if (cores < 4 || (memoryGb !== null && memoryGb < 6)) {
      return "unsupported";
    }
    if (cores < 6 || (memoryGb !== null && memoryGb < 6)) {
      return "slow";
    }
    if (cores >= 8 && (memoryGb === null || memoryGb >= 10)) {
      return "excellent";
    }
    if (cores >= 8 && (memoryGb === null || memoryGb >= 8)) {
      return "good";
    }
    return "usable";
  }

  if (cores < 4 || (memoryGb !== null && memoryGb < 4)) {
    return "unsupported";
  }
  if (cores < 6 || (memoryGb !== null && memoryGb < 6)) {
    return "slow";
  }
  if (cores >= 10 && (memoryGb === null || memoryGb >= 12)) {
    return "excellent";
  }
  if (cores >= 8 && (memoryGb === null || memoryGb >= 8)) {
    return "good";
  }
  return "usable";
}

/** Desktop: Usable+; mobile: Good+. */
export function canRunLocalNemotron(performanceClass: PerformanceClass = classifyDevice()): boolean {
  const minimum: PerformanceClass = isNativeMobile() ? "good" : "usable";
  return meetsMinimum(performanceClass, minimum);
}

export function getDeviceCapabilitySnapshot(): DeviceCapabilitySnapshot {
  const performanceClass = classifyDevice();
  return {
    performanceClass,
    hardwareConcurrency: readHardwareConcurrency(),
    deviceMemoryGb: readDeviceMemoryGb(),
    isTauri: isTauri(),
    isNativeMobile: isNativeMobile(),
    canRunLocalNemotron: canRunLocalNemotron(performanceClass),
  };
}

/** Mobile install gate (Phases 8–9): block unsupported, warn on slow. */
export interface RealtimeSessionHealth {
  shouldWarn: boolean;
  reason?: string;
}

interface BatteryStatus {
  level: number;
  charging: boolean;
}

async function readBatteryStatus(): Promise<BatteryStatus | null> {
  if (typeof navigator === "undefined") return null;
  const manager = (navigator as Navigator & {
    getBattery?: () => Promise<{ level: number; charging: boolean }>;
  }).getBattery;
  if (!manager) return null;
  try {
    const battery = await manager.call(navigator);
    return { level: battery.level, charging: battery.charging };
  } catch {
    return null;
  }
}

/** Mobile thermal/battery guard for sustained realtime transcription (Phase 10.4). */
export async function checkRealtimeSessionHealth(): Promise<RealtimeSessionHealth> {
  if (!isNativeMobile()) {
    return { shouldWarn: false };
  }

  const battery = await readBatteryStatus();
  if (battery && !battery.charging && battery.level < 0.2) {
    return {
      shouldWarn: true,
      reason:
        "Battery is below 20% and not charging. Sustained realtime transcription may drain power quickly.",
    };
  }

  const performanceClass = classifyDevice();
  if (performanceClass === "slow") {
    return {
      shouldWarn: true,
      reason:
        "This device may run hot or fall behind during sustained realtime transcription. Consider cloud pseudo-streaming.",
    };
  }

  return { shouldWarn: false };
}

export function getMobileNemotronInstallRecommendation(): MobileNemotronInstallRecommendation {
  const performanceClass = classifyDevice();

  if (!isNativeMobile()) {
    return { allowed: true, performanceClass };
  }

  if (performanceClass === "unsupported") {
    return {
      allowed: false,
      warning:
        "This device does not meet the minimum requirements for on-device Nemotron ASR. Use cloud transcription instead.",
      performanceClass,
    };
  }

  if (performanceClass === "slow") {
    return {
      allowed: true,
      warning:
        "Local Nemotron may run slowly on this device. You can install anyway or use cloud OpenRouter Nemotron.",
      performanceClass,
    };
  }

  return { allowed: true, performanceClass };
}
