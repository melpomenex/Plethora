/**
 * Architecture Invariant Guard: Reading and review never consult entitlements.
 *
 * Enforces that no module under the readers, viewers, queue, review-session,
 * or scheduling core imports the entitlement store or checks capability state.
 *
 * Plethora philosophy: do not paywall reading; paywall augmentation.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC_ROOT = join(__dirname, '..');

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      out.push(...listSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('entitlements architecture invariants', () => {
  it('core reading, viewing, and review modules never import entitlements', () => {
    const protectedDirs = [
      join(SRC_ROOT, 'components', 'viewer'),
      join(SRC_ROOT, 'pages'),
    ];

    const protectedIndividualFiles = [
      join(SRC_ROOT, 'stores', 'documentStore.ts'),
      join(SRC_ROOT, 'stores', 'queueStore.ts'),
      join(SRC_ROOT, 'stores', 'reviewStore.ts'),
    ];

    const allProtectedFiles: string[] = [];
    for (const dir of protectedDirs) {
      allProtectedFiles.push(...listSourceFiles(dir));
    }
    for (const file of protectedIndividualFiles) {
      allProtectedFiles.push(file);
    }

    const forbiddenImports = [
      'entitlementStore',
      'useEntitlementStore',
      'useCapability',
      'CapabilityGate',
      'types/entitlements',
    ];

    const violations: string[] = [];

    for (const filePath of allProtectedFiles) {
      const content = readFileSync(filePath, 'utf8');
      for (const needle of forbiddenImports) {
        if (content.includes(needle)) {
          violations.push(`${filePath}: found "${needle}"`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
