import { describe, expect, it } from 'vitest';
import { actionStripGeometry } from '../actionStripGeometry';
describe('optional action chrome', () => {
  it('suppresses actions before losing the 96px conversation minimum or partial detent', () => {
    expect(actionStripGeometry(252, 48, 320, false)).toEqual({ suppress: true, singleDetent: false });
    expect(actionStripGeometry(196, 0, 320, true)).toEqual({ suppress: true, singleDetent: false });
    expect(actionStripGeometry(252, 0, 320, true)).toEqual({ suppress: true, singleDetent: true });
  });
  it('retains both detents when chrome fits and restores only after threshold hysteresis', () => {
    expect(actionStripGeometry(220, 48, 400, false)).toEqual({ suppress: false, singleDetent: false });
    expect(actionStripGeometry(160, 0, 320, true).suppress).toBe(true);
    expect(actionStripGeometry(150, 0, 320, true).suppress).toBe(false);
  });
});
