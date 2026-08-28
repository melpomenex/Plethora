/**
 * Local-only ambient renderer diagnostics.
 *
 * Maintains a snapshot of renderer state plus a ring buffer of recent frame
 * costs and their rAF timestamps. Exposed as `window.__plethoraAmbientDiagnostics`
 * ONLY in dev builds or when the user opts in via localStorage — never
 * transmitted anywhere, never part of telemetry. GPU renderer/vendor strings
 * (when obtainable via WEBGL_debug_renderer_info) live only inside this local
 * object.
 */
import type { ThemeRendererBackend } from "./types";

export interface AmbientDiagnostics {
  effectId: string;
  backend: ThemeRendererBackend | "none";
  fpsTarget: number;
  fpsMeasured: number;
  frameCostMeanMs: number | null;
  frameCostP95Ms: number | null;
  droppedByGate: number;
  renderWidth: number;
  renderHeight: number;
  renderScale: number;
  devicePixelRatio: number;
  density: number;
  onBattery: boolean;
  reducedMotion: boolean;
  visible: boolean;
  webgl2Available: boolean | null;
  glVendor: string | null;
  glRenderer: string | null;
  contextLosses: number;
  adaptiveStepIndex: number;
  /** Recent frame costs (ms), oldest first, capped at FRAME_COST_WINDOW. */
  frameCosts: number[];
}

export const FRAME_COST_WINDOW = 120;

const OPTIN_KEY = "plethora.ambientDiagnostics";

export function isDiagnosticsEnabled(): boolean {
  try {
    if (typeof window === "undefined") return false;
    const dev = typeof import.meta !== "undefined" && (import.meta as { env?: { DEV?: boolean } }).env?.DEV;
    if (dev) return true;
    return window.localStorage?.getItem(OPTIN_KEY) === "1";
  } catch {
    return false;
  }
}

export function createDiagnosticsSnapshot(effectId: string): AmbientDiagnostics {
  return {
    effectId,
    backend: "none",
    fpsTarget: 0,
    fpsMeasured: 0,
    frameCostMeanMs: null,
    frameCostP95Ms: null,
    droppedByGate: 0,
    renderWidth: 0,
    renderHeight: 0,
    renderScale: 1,
    devicePixelRatio:
      typeof window !== "undefined" && Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : 1,
    density: 1,
    onBattery: false,
    reducedMotion: false,
    visible: true,
    webgl2Available: null,
    glVendor: null,
    glRenderer: null,
    contextLosses: 0,
    adaptiveStepIndex: 0,
    frameCosts: [],
  };
}

export interface DiagnosticsSink {
  snapshot: AmbientDiagnostics;
  /** Record one drawn frame (cost in ms, rAF timestamp in ms). */
  recordFrame(costMs: number, timestampMs: number): void;
  /** Publish to window when enabled; cheap no-op otherwise. */
  publish(): void;
}

export function createDiagnosticsSink(effectId: string): DiagnosticsSink {
  const snapshot = createDiagnosticsSnapshot(effectId);
  const timestamps: number[] = [];

  const recompute = () => {
    const costs = snapshot.frameCosts;
    if (costs.length === 0) {
      snapshot.frameCostMeanMs = null;
      snapshot.frameCostP95Ms = null;
      snapshot.fpsMeasured = 0;
      return;
    }
    let sum = 0;
    for (const c of costs) sum += c;
    snapshot.frameCostMeanMs = sum / costs.length;
    const sorted = [...costs].sort((a, b) => a - b);
    snapshot.frameCostP95Ms = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
    if (timestamps.length >= 2) {
      const span = timestamps[timestamps.length - 1] - timestamps[0];
      snapshot.fpsMeasured = span > 0 ? Math.round(((timestamps.length - 1) / span) * 1000) : 0;
    } else {
      snapshot.fpsMeasured = 0;
    }
  };

  return {
    snapshot,
    recordFrame(costMs: number, timestampMs: number) {
      if (!Number.isFinite(costMs) || costMs < 0) return;
      snapshot.frameCosts.push(costMs);
      timestamps.push(Number.isFinite(timestampMs) ? timestampMs : 0);
      if (snapshot.frameCosts.length > FRAME_COST_WINDOW) {
        snapshot.frameCosts.splice(0, snapshot.frameCosts.length - FRAME_COST_WINDOW);
        timestamps.splice(0, timestamps.length - FRAME_COST_WINDOW);
      }
      recompute();
    },
    publish() {
      if (!isDiagnosticsEnabled() || typeof window === "undefined") return;
      (window as unknown as { __plethoraAmbientDiagnostics?: AmbientDiagnostics }).__plethoraAmbientDiagnostics =
        snapshot;
    },
  };
}
