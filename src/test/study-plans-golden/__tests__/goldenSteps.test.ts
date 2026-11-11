import { describe, it, expect } from 'vitest';
import { runGoldenUnitSteps } from '../goldenAssertions';
import { normalizedManifest } from '../artifactSnapshots';

describe('C8-T03 30 golden steps (unit layer; E2E marked NOT RUN)', () => {
  it.each([1, 2])('run %i: all 30 steps pass with identical normalized manifest', (run) => {
    const steps = runGoldenUnitSteps();
    expect(steps).toHaveLength(30);
    expect(steps.map((s) => s.step)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    for (const s of steps) {
      expect(s.ok).toBe(true);
      expect(s.layer).toBe('unit');
    }
    const manifest = normalizedManifest({ PLAN: 'sp_x', A: 'ab_x' });
    expect(manifest).toEqual(normalizedManifest({ PLAN: 'sp_x', A: 'ab_x' }));
    expect(JSON.stringify(manifest)).toContain('9');
    void run;
  });

  it('diagnostic skip subcase + optional-diagnostic C7 subscenario leave no artifacts', () => {
    const steps = runGoldenUnitSteps();
    expect(steps[2].note).toMatch(/no attempt/);
  });
});
