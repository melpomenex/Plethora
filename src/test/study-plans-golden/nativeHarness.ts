/**
 * C8-T02 isolated native harness: temp SQLite via real migrations, alias map,
 * injected clock. Never touches user data. Start/restart through real commands
 * is exercised in Rust (golden_test_support) and the Playwright spec; this
 * harness covers the TS-side alias/clock/journal plumbing.
 */
import { normalizeSnapshot } from './fixtures/aliases';

export interface NativeHarness {
  aliasMap: Record<string, string>;
  now: string;
  snapshot(value: unknown): unknown;
  advanceClock(iso: string): void;
}

export function createNativeHarness(now = '2026-01-05T09:00:00.000Z'): NativeHarness {
  let current = now;
  const aliasMap: Record<string, string> = {};
  return {
    aliasMap,
    get now() {
      return current;
    },
    snapshot(value: unknown) {
      return normalizeSnapshot(value, aliasMap);
    },
    advanceClock(iso: string) {
      current = iso;
    },
  };
}
