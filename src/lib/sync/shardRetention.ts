export interface RetentionState {
  createdAt: number;
  acknowledgedDevices: string[];
  activeDevices: string[];
  minimumRetentionMs: number;
}

export function canRetireShard(state: RetentionState, now = Date.now()): boolean {
  if (now - state.createdAt < state.minimumRetentionMs) return false;
  const acknowledged = new Set(state.acknowledgedDevices);
  return state.activeDevices.every((device) => acknowledged.has(device));
}
