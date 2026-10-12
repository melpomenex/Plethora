import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { BENCH_PACKAGE, parseMarker, sampleFromMarkers, summarize, summarizeReport } from '../android-startup/report.mjs';

test('parses monotonic clocks and rejects unrelated or malformed log messages', () => {
  assert.equal(parseMarker('private document text'), null);
  assert.equal(parseMarker('12.012 123 456 I PlethoraStartup: broken'), null);
  assert.deepEqual(parseMarker('12.012 123 456 I PlethoraStartup: {"phase":"native-ready","elapsedMs":1500}'),
    { phase: 'native-ready', elapsedMs: 1500, logMonotonicMs: 12012, logPid: 123, logTid: 456 });
});

test('activity start, placeholder paint, hydration, and debug builds cannot satisfy the endpoint', () => {
  const markers = [{ phase: 'activity-create', elapsedMs: 0, debug: false },
    { phase: 'bootstrap-entry', elapsedMs: 30 }, { phase: 'snapshot-hydrated', elapsedMs: 90 }];
  assert.equal(sampleFromMarkers(markers).status, 'incomplete');
  markers.push({ phase: 'surface-ready', surface: 'queue', sequence: 5 },
    { phase: 'interaction-ready', surface: 'queue', sequence: 6, activityElapsedMs: 150 });
  assert.equal(sampleFromMarkers(markers).usableMs, 150);
  markers[0].debug = true;
  assert.equal(sampleFromMarkers(markers).status, 'incomplete');
});

test('reports every sample, median and nearest-rank p95 including failed launches', () => {
  const samples = Array.from({ length: 20 }, (_, i) => ({ status: 'usable', usableMs: (i + 1) * 100 }));
  assert.deepEqual(summarize(samples), { total: 20, usable: 20, failed: 0, medianMs: 1050, p95Ms: 1900, passed: true });
  samples[0] = { status: 'incomplete', usableMs: null };
  assert.equal(summarize(samples).failed, 1);
  assert.equal(summarize(samples).passed, false);
  assert.equal(summarize([]).p95Ms, null);
});

test('counts requests without command arguments and records clock correlation pairs', () => {
  const sample = sampleFromMarkers([
    { phase: 'command-dispatch', command: 'wait_for_backend_ready' },
    { phase: 'command-dispatch', command: 'get_startup_snapshot' },
    { phase: 'command-dispatch', command: 'wait_for_backend_ready' },
    { phase: 'command-response', clock: 'frontend', sequence: 3, elapsedMs: 10, activityElapsedMs: 100 },
  ]);
  assert.equal(sample.readinessRequests, 2); assert.equal(sample.snapshotRequests, 1);
  assert.deepEqual(sample.frontendClockPairs, [{ sequence: 3, frontendElapsedMs: 10, activityReceiptMs: 100 }]);
  assert.equal(BENCH_PACKAGE, 'com.plethora.app.startupbench');
});

test('diagnostic compiler overrides cannot pass the reference performance gate', () => {
  const samples = Array.from({ length: 20 }, () => ({ status: 'usable', usableMs: 1000 }));
  assert.equal(summarizeReport({ samples, identity: { optimization: { lto: 'false', codegenUnits: 16, optLevel: '1' } } }).passed, false);
  assert.equal(summarizeReport({ samples, identity: { optimization: { lto: 'thin', codegenUnits: 4, optLevel: 'z' } } }).passed, true);
});

test('rejects unknown flags before invoking adb and exposes version/help', () => {
  assert.equal(execFileSync('node', ['scripts/android-startup.mjs', '--version'], { encoding: 'utf8' }).trim(), '1.0.0');
  const result = spawnSync('node', ['scripts/android-startup.mjs', 'run', '--package', 'com.plethora.app'], { encoding: 'utf8' });
  assert.equal(result.status, 2); assert.match(result.stdout, /Unknown option|unknown.*package/i);
  assert.match(result.stdout, /--serial/);
});
