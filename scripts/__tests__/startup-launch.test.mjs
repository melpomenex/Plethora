import assert from 'node:assert/strict';
import test from 'node:test';
import { configurationId, FIXTURE, statistics, summarizeLaunchReport } from '../startup-launch/report.mjs';
import { readMarker, visibleTransition } from '../startup-launch/linux.mjs';

const configuration = {
  platform: 'linux-appimage', mode: 'packaged', release: true, artifactSha256: 'a'.repeat(64),
  launcher: 'AppImage runtime', os: 'Linux', hardware: 'test', engine: 'WebKitGTK',
  display: 'X11', cache: 'warm', connectivity: 'offline', animation: 'on', fixture: FIXTURE,
};

function makeReport() {
  const id = configurationId(configuration);
  return { configuration, samples: Array.from({ length: 20 }, (_, index) => ({
    sample: index + 1, configurationId: id, processCold: true, status: 'usable', mode: 'fuse',
    shell: { ms: 500, paint: true, input: true },
    usable: { ms: 1000, paint: true, input: true },
  })) };
}

test('median and nearest-rank p95 use their respective ranks', () => {
  assert.deepEqual(statistics([4, 1, 2, 3]), { medianMs: 2.5, p95Ms: 4 });
  assert.deepEqual(statistics(Array.from({ length: 20 }, (_, i) => 20 - i)), { medianMs: 10.5, p95Ms: 19 });
  assert.deepEqual(statistics([]), { medianMs: null, p95Ms: null });
});

test('a complete configuration passes and changing its identity invalidates samples', () => {
  const report = makeReport();
  assert.equal(summarizeLaunchReport(report).passed, true);
  assert.equal(configurationId(configuration), configurationId({ ...configuration, fixture: { learningItems: 5000, documents: 1000 } }));
  report.configuration = { ...configuration, cache: 'fresh' };
  assert.equal(summarizeLaunchReport(report).failedSamples.length, 20);
});

test('missing and invalid endpoints fail while failed launches remain in the total', () => {
  const report = makeReport();
  report.samples[0].usable = null;
  report.samples[1].shell.ms = Number.NaN;
  report.samples[2].usable.ms = 499;
  report.samples[3].usable.input = false;
  report.samples[4].shell.paint = false;
  report.samples[5].status = 'process-exited';
  report.samples[6].processCold = false;
  report.samples[7].sample = 7;
  report.samples[8].mode = 'extract-and-run';
  const summary = summarizeLaunchReport(report);
  assert.equal(summary.total, 20);
  assert.deepEqual(summary.failedSamples, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(summary.passed, false);
});

test('an incomplete matrix and a p95 budget violation both fail', () => {
  const report = makeReport();
  report.samples.pop();
  assert.equal(summarizeLaunchReport(report).passed, false);
  report.samples.push({ ...report.samples[0], sample: 20, usable: { ...report.samples[0].usable } });
  report.samples[18].usable.ms = 2001;
  report.samples[19].usable.ms = 2002;
  assert.equal(summarizeLaunchReport(report).usable.p95Ms, 2001);
  assert.equal(summarizeLaunchReport(report).passed, false);
});

test('Linux observation retains timing and uses safe phase metadata', () => {
  assert.deepEqual(readMarker('CONSOLE [startup:frontend] {"phase":"recovery-visible","elapsedMs":15000,"sequence":3,"private":"discard"}', 15100),
    { phase: 'recovery-visible', elapsedMs: 15000, sequence: 3, observedMs: 15100, clock: 'frontend' });
  assert.equal(readMarker('[startup:native] {"phase":"native-entry","elapsedMs":-1}', 5), null);
  assert.equal(readMarker('x'.repeat(5000), 5), null);
});

test('a ready marker alone cannot pass an obscured or unresponsive display', () => {
  const expectation = { before: /Queue/, after: /Dashboard ready/ };
  assert.equal(visibleTransition('Queue', 'Dashboard ready', expectation), true);
  assert.equal(visibleTransition('Queue', 'Queue', expectation), false);
  assert.equal(visibleTransition('Covered', 'Dashboard ready', expectation), false);
  assert.equal(visibleTransition('Queue Dashboard ready', 'Dashboard ready', expectation), false);
});
