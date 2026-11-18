const IDLE_FALLBACK_MS = 3_000;
const pending = new Set<() => void>();
let localReadyAt: number | undefined;
let scheduled = false;

function scheduleNext() {
  if (localReadyAt === undefined || scheduled || pending.size === 0) return;
  scheduled = true;
  const remaining = Math.max(0, IDLE_FALLBACK_MS - (performance.now() - localReadyAt));
  const run = () => {
    const next = pending.values().next().value;
    if (next) pending.delete(next);
    try {
      next?.();
    } finally {
      scheduled = false;
      scheduleNext();
    }
  };
  if (remaining > 0 && typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(run, { timeout: remaining });
  } else {
    window.setTimeout(run, remaining);
  }
}

export function afterLocalStartupReady(task: () => void): () => void {
  pending.add(task);
  scheduleNext();
  return () => pending.delete(task);
}

export function hasLocalStartupReady(): boolean {
  return localReadyAt !== undefined;
}

export function markLocalStartupReady() {
  if (localReadyAt !== undefined) return;
  if (window.__plethoraStartupAttempt?.failed) return;
  localReadyAt = performance.now();
  window.__plethoraStartupAttempt?.dataLoaded();
  scheduleNext();
}
