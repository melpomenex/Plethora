export interface SessionProgress {
  sessionId: string;
  position: number;
  updatedAt: string;
  resetAt?: string | null;
}

export function mergeSessionProgress(local: SessionProgress | null, remote: SessionProgress): SessionProgress {
  if (!local) return remote;
  const localReset = local.resetAt ?? "";
  const remoteReset = remote.resetAt ?? "";
  if (remoteReset > localReset) return remote;
  if (localReset > remoteReset) return local;
  if (remote.sessionId === local.sessionId) {
    const winner = remote.updatedAt >= local.updatedAt ? remote : local;
    return { ...winner, position: Math.max(local.position, remote.position) };
  }
  // Concurrent sessions: latest session metadata wins; within the same
  // session progress is monotonic, while an explicit reset can move backward.
  return remote.updatedAt >= local.updatedAt ? remote : local;
}
