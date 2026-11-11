import { describe, it, expect } from 'vitest';
import { ScriptedProvider } from '../scriptedProvider';
import { ProviderJournal } from '../providerJournal';
import { assertLocalUrl } from '../networkGuard';
import { createNativeHarness } from '../nativeHarness';

describe('C8-T02 scripted provider + harness', () => {
  it('matches registered task fixtures; unexpected request fails; journal is metadata-only', async () => {
    const provider = new ScriptedProvider();
    provider.script({ taskId: 'study-curriculum-decompose', requestHash: 'rh1', stepKey: 'decompose:0000', attemptCount: 1 }, { topics: ['n1'] });
    const out = await provider.call<{ topics: string[] }>(
      { taskId: 'study-curriculum-decompose', requestHash: 'rh1', stepKey: 'decompose:0000', attemptCount: 1 },
      { routeClass: 'device', payloadClasses: ['goal', 'source-batch'], consented: true },
    );
    expect(out).toEqual({ topics: ['n1'] });
    await expect(
      provider.call({ taskId: 'study-curriculum-decompose', requestHash: 'rhX', stepKey: 'decompose:0000', attemptCount: 1 }, { routeClass: 'device', payloadClasses: [], consented: true }),
    ).rejects.toThrow('unexpected call');
    const journal = provider.journal.getCalls();
    expect(journal).toHaveLength(2);
    expect(JSON.stringify(journal)).not.toMatch(/secret|answer|excerpt/i);
  });

  it('denies external network; allows loopback', () => {
    expect(() => assertLocalUrl('https://example.com/x')).toThrow('external network denied');
    expect(() => assertLocalUrl('http://localhost:5199/')).not.toThrow();
  });

  it('harness alias map + injected clock normalize snapshots', () => {
    const h = createNativeHarness();
    h.aliasMap.PLAN = 'sp_abc';
    expect(h.snapshot({ id: 'sp_abc', at: '2026-01-05T09:00:00.000Z' })).toEqual({ id: '<PLAN>', at: '<TIMESTAMP>' });
    h.advanceClock('2026-01-05T12:00:00.000Z');
    expect(h.now).toBe('2026-01-05T12:00:00.000Z');
  });

  it('provider journal records task/requestHash/stepKey/attemptCount safely', () => {
    const j = new ProviderJournal();
    j.record({ taskId: 't', requestHash: 'rh', stepKey: 's', attemptCount: 1, routeClass: 'loopback', payloadClasses: ['goal'], consented: false });
    expect(j.count()).toBe(1);
  });
});
