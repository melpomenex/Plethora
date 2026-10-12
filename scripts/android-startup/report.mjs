/** Pure, deterministic report math; device timings never become unit-test assertions. */
export const BENCH_PACKAGE = 'com.plethora.app.startupbench';

export function parseMarker(line) {
  const match = line.match(/^\s*(\d+\.\d+)\s+(\d+)\s+(\d+)\s+\w\s+PlethoraStartup\s*:\s*(\{.*\})\s*$/);
  if (!match) return null;
  try {
    const marker = JSON.parse(match[4]);
    if (typeof marker.phase !== 'string' || !Number.isFinite(marker.elapsedMs)) return null;
    return { ...marker, logMonotonicMs: Number(match[1]) * 1000, logPid: Number(match[2]), logTid: Number(match[3]) };
  } catch { return null; }
}

export function sampleFromMarkers(markers) {
  const create = markers.find((m) => m.phase === 'activity-create');
  const ready = markers.find((m) => m.phase === 'interaction-ready');
  const hydrated = markers.find((m) => m.phase === 'snapshot-hydrated');
  const surface = markers.find((m) => m.phase === 'surface-ready' && m.surface === ready?.surface);
  const valid = create && create.debug === false && hydrated && surface && ready
    && ready.sequence > surface.sequence && ready.activityElapsedMs >= 0;
  return {
    status: valid ? 'usable' : 'incomplete',
    usableMs: valid ? ready.activityElapsedMs : null,
    readinessRequests: markers.filter((m) => m.phase === 'command-dispatch' && m.command === 'wait_for_backend_ready').length,
    snapshotRequests: markers.filter((m) => m.phase === 'command-dispatch' && m.command === 'get_startup_snapshot').length,
    markers,
    // Receipt includes console delivery latency. Each pair correlates clocks
    // explicitly; no subtraction of Rust Instant and performance.now epochs.
    frontendClockPairs: markers.filter((m) => m.clock === 'frontend').map((m) => ({
      sequence: m.sequence, frontendElapsedMs: m.elapsedMs, activityReceiptMs: m.activityElapsedMs,
    })),
  };
}

export function summarize(samples) {
  const times = samples.filter((s) => s.status === 'usable').map((s) => s.usableMs).sort((a, b) => a - b);
  const n = times.length;
  const median = n ? (times[Math.floor((n - 1) / 2)] + times[Math.floor(n / 2)]) / 2 : null;
  const p95 = n ? times[Math.ceil(n * 0.95) - 1] : null;
  return { total: samples.length, usable: n, failed: samples.length - n, medianMs: median, p95Ms: p95,
    passed: samples.length >= 20 && n === samples.length && p95 <= 5000 };
}

export function summarizeReport(report) {
  const summary = summarize(report.samples);
  const profile = report.identity?.optimization;
  const referenceProfile = profile?.lto === 'thin' && profile.codegenUnits === 4 && profile.optLevel === 'z';
  return { ...summary, referenceProfile, passed: summary.passed && referenceProfile };
}
