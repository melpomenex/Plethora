import { describe, it, expect } from 'vitest';
import { getJobKind, listJobKinds } from '../jobs/registry.js';
import '../jobs/kinds/index.js';

describe('job registry', () => {
  it('registers noop_probe kind', () => {
    expect(listJobKinds()).toContain('noop_probe');
    const def = getJobKind('noop_probe');
    expect(def?.timeoutMs).toBeGreaterThan(0);
    expect(def?.maxAttempts).toBeGreaterThan(0);
  });

  it('validates noop_probe params', () => {
    const def = getJobKind('noop_probe')!;
    const parsed = def.paramsSchema.parse({ steps: 2, delayMs: 10 });
    expect(parsed.steps).toBe(2);
  });
});
