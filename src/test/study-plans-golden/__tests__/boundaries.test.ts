import { describe, it, expect } from 'vitest';
import { privacyMatrix } from '../privacyMatrix';
import { offlineMatrix } from '../offlineMatrix';
import { sourceNavigationMatrix } from '../sourceNavigationMatrix';
import { schedulerIsolation } from '../schedulerIsolation';

describe('C8-T05 offline/privacy/source/scheduler boundaries', () => {
  it.each([
    ['privacy', privacyMatrix],
    ['offline', offlineMatrix],
    ['source-navigation', sourceNavigationMatrix],
    ['scheduler', schedulerIsolation],
  ])('%s matrix: every row passes with no uncontested failure', (_group, rows) => {
    for (const r of rows as Array<{ name: string; run: () => boolean }>) {
      expect(r.run(), r.name).toBe(true);
    }
  });

  it('audio/YouTube explicitly NOT QUALIFIED (no generic local-video claim)', () => {
    expect(sourceNavigationMatrix[3].run()).toBe(true);
  });
});
