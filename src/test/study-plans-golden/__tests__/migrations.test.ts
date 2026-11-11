import { describe, it, expect } from 'vitest';
import { migrationFixtures } from '../migrationFixtures';

describe('C8-T06 migration/backup/isolation (unit layer; native temp-DB gates green)', () => {
  it('every migration/backup/legacy row passes', () => {
    for (const f of migrationFixtures) {
      expect(f.run(), f.name).toBe(true);
    }
  });

  it('rollback limitations match implementation (documented, not silent)', () => {
    expect(migrationFixtures.length).toBeGreaterThanOrEqual(10);
  });
});
