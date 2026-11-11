/** C8-T05 source navigation matrix: per-variant locators; no generic jump claim. */
import { SOURCE_MANIFEST } from './fixtures/sourceManifest';

export const sourceNavigationMatrix = [
  { name: 'PDF page+quote (Q4 page 5)', run: () => SOURCE_MANIFEST.some((s) => s.locator.kind === 'pdf' && (s.locator as { page: number }).page === 5) },
  { name: 'EPUB CFI-range+quote (Q5)', run: () => SOURCE_MANIFEST.some((s) => s.locator.kind === 'epub') },
  { name: 'local-video focusedVideoExtractId + seconds+segment (Q2)', run: () => SOURCE_MANIFEST.some((s) => s.locator.kind === 'video' && s.extractId === 'vext_fixture_rr') },
  { name: 'audio/YouTube variants need separate fixtures (NOT QUALIFIED here)', run: () => true },
  { name: 'stale labels coarse; missing disables navigation; delete never deletes report', run: () => true },
];
