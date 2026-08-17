/**
 * Lazy, cached loader for the article-pipeline libraries.
 *
 * `defuddle`, `@mozilla/readability`, and `dompurify` are loaded via dynamic
 * `import()` on first article import and cached — app startup executes none of
 * them (design D12). In Tauri builds Vite inlines dynamic imports into the
 * entry chunk (size accounted in scripts/bundle-budgets.json); PWA builds get
 * a separate `article-vendor` manual chunk.
 *
 * `useAsync` is disabled for Defuddle: its async extractors would hit
 * third-party APIs, which the pipeline forbids (no network beyond the single
 * fetch the user's URL implies, and tests must be hermetic).
 */

import type Defuddle from 'defuddle';
import type { Readability } from '@mozilla/readability';

type DefuddleModule = typeof import('defuddle');
type ReadabilityModule = typeof import('@mozilla/readability');
type DomPurifyModule = typeof import('dompurify');

export type DefuddleCtor = typeof Defuddle;
export type ReadabilityCtor = typeof Readability;

let defuddlePromise: Promise<DefuddleModule> | null = null;
let readabilityPromise: Promise<ReadabilityModule> | null = null;
let domPurifyPromise: Promise<DomPurifyModule> | null = null;

export function loadDefuddle(): Promise<DefuddleModule> {
  defuddlePromise ??= import('defuddle');
  return defuddlePromise;
}

export function loadReadability(): Promise<ReadabilityModule> {
  readabilityPromise ??= import('@mozilla/readability');
  return readabilityPromise;
}

export function loadDomPurify(): Promise<DomPurifyModule> {
  domPurifyPromise ??= import('dompurify');
  return domPurifyPromise;
}

/** Test-only: drop cached modules so load failures can be re-exercised. */
export function resetEngineLoaderCache(): void {
  defuddlePromise = null;
  readabilityPromise = null;
  domPurifyPromise = null;
}
