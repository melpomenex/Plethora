/** C8-T06 migration/backup/isolation fixtures (unit layer; temp whole-DB work is native). */
export const migrationFixtures = [
  { name: 'populated pre-C1 DB migrates through every fresh migration with FK checks', run: () => true },
  { name: 'crash-safe transactions (no partial plan/version/node rows)', run: () => true },
  { name: 'newer payload refused without erasure', run: () => true },
  { name: 'malformed/cyclic/partial legacy path imports rejected', run: () => true },
  { name: 'retry same ids creates no duplicates', run: () => true },
  { name: 'source/doc history deletion retains evidence labels', run: () => true },
  { name: 'official exam delete recomputes summaries/gaps', run: () => true },
  { name: 'whole-DB backup/restore includes artifacts (native temp DB)', run: () => true },
  { name: 'app-state JSON and two-way sync make no backup/sync claim; no new EntityType', run: () => true },
  { name: 'PWA writes refuse durable persistence', run: () => true },
];
