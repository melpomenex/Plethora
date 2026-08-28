import { describe, expect, it } from 'vitest';
import {
  assertStoreProfileApiUrl,
  isLegacyApiUrl,
  PLETHORA_LEGACY_API_URL,
  PLETHORA_PRODUCTION_API_URL,
  resolvePlethoraApiUrl,
} from '../apiUrl';

describe('apiUrl contract', () => {
  it('defaults to production API when env unset', () => {
    expect(resolvePlethoraApiUrl({})).toEqual({
      url: PLETHORA_PRODUCTION_API_URL,
      source: 'production-default',
    });
  });

  it('detects legacy provisional domain', () => {
    expect(isLegacyApiUrl(PLETHORA_LEGACY_API_URL)).toBe(true);
    expect(isLegacyApiUrl(PLETHORA_PRODUCTION_API_URL)).toBe(false);
  });

  it('store profile requires production API URL', () => {
    expect(() => assertStoreProfileApiUrl(PLETHORA_PRODUCTION_API_URL, 'store')).not.toThrow();
    expect(() => assertStoreProfileApiUrl(PLETHORA_LEGACY_API_URL, 'store')).toThrow(/obsolete/);
    expect(() => assertStoreProfileApiUrl('https://api.example.com', 'store')).toThrow(/expected/);
  });
});
