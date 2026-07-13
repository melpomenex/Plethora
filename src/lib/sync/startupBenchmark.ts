export interface StartupBenchmarkResult {
  syncEnabledMs: number;
  syncDisabledMs: number;
  overheadMs: number;
  longTaskCount: number;
  passes: boolean;
}

export async function runStartupBenchmark(args: {
  boot: (syncEnabled: boolean) => Promise<void>;
  maxOverheadMs?: number;
}): Promise<StartupBenchmarkResult> {
  const measure = async (syncEnabled: boolean): Promise<number> => {
    const started = performance.now();
    await args.boot(syncEnabled);
    return performance.now() - started;
  };
  const syncDisabledMs = await measure(false);
  const syncEnabledMs = await measure(true);
  const overheadMs = syncEnabledMs - syncDisabledMs;
  const result = {
    syncEnabledMs,
    syncDisabledMs,
    overheadMs,
    // A real browser harness can replace this with PerformanceObserver data;
    // the unit harness intentionally has no synthetic long tasks.
    longTaskCount: 0,
    passes: overheadMs <= (args.maxOverheadMs ?? 100),
  };
  return result;
}
