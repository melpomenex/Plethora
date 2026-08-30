import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRANSCRIPTION_LIMIT_SECONDS,
  TRANSCRIPTION_CAPABILITY,
} from '../quota/transcription.js';

describe('transcription quota constants', () => {
  it('stores monthly allowance as seconds (120 minutes)', () => {
    expect(DEFAULT_TRANSCRIPTION_LIMIT_SECONDS).toBe(120 * 60);
  });

  it('uses the canonical transcription capability id', () => {
    expect(TRANSCRIPTION_CAPABILITY).toBe('transcription');
  });
});
