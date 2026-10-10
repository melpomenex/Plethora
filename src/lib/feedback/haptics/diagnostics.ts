import type { HapticEffect } from "./types";

/** Only protocol/state metadata belongs here. Never include content or entity IDs. */
export interface HapticDiagnostic {
  stage: string;
  reason?: string;
  effect?: HapticEffect;
  event?: string;
  details?: Record<string, string | number | boolean | null>;
  at?: number;
}

const entries: HapticDiagnostic[] = [];
const lastLogged = new Map<string, number>();
const subscribers = new Set<() => void>();
export const HAPTIC_DIAGNOSTICS_ENABLED = import.meta.env.DEV || import.meta.env.VITE_PLETHORA_HAPTIC_DIAGNOSTICS === "true";

export function recordHapticDiagnostic(entry: HapticDiagnostic): void {
  const now = Date.now();
  entries.push({ ...entry, at: now });
  if (entries.length > 64) entries.shift();
  subscribers.forEach((notify) => notify());
  if (!HAPTIC_DIAGNOSTICS_ENABLED) return;
  const key = `${entry.stage}:${entry.reason ?? "ok"}`;
  if (now - (lastLogged.get(key) ?? -Infinity) < 2_000) return;
  if (lastLogged.size >= 64) lastLogged.clear();
  lastLogged.set(key, now);
  console.debug("[haptics]", entry);
}

export function getHapticDiagnostics(): readonly HapticDiagnostic[] { return [...entries]; }
export function subscribeHapticDiagnostics(notify: () => void): () => void {
  subscribers.add(notify);
  return () => { subscribers.delete(notify); };
}

export function __resetHapticDiagnosticsForTests(): void {
  entries.length = 0;
  lastLogged.clear();
}
