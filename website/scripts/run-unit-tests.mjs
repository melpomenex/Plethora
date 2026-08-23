#!/usr/bin/env node
import { globSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  ...globSync('src/config/*.test.ts', { cwd: websiteRoot }),
  ...globSync('src/components/demo/*.test.ts', { cwd: websiteRoot }),
  ...globSync('tests/unit/*.test.ts', { cwd: websiteRoot }),
  ...globSync('tests/commercial/*.test.ts', { cwd: websiteRoot }),
];

if (files.length === 0) {
  console.error('No unit test files found');
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ['--experimental-strip-types', '--test', ...files],
  { cwd: websiteRoot, stdio: 'inherit' },
);

process.exit(result.status === null ? 1 : result.status);
