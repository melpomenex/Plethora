import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { freezeSource } from '../android-startup/identity.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'startup-identity-test-'));
  const directory = join(root, 'baseline');
  const files = {
    'src/main.tsx': 'baseline application',
    'src/lib/consoleLogcatBridge.ts': 'baseline forwarder',
    'src-tauri/Cargo.toml': '[package]\nname = "fixture"',
  };
  const manifest = Object.entries(files).map(([path, value]) => {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), value);
    return { path, sha256: createHash('sha256').update(value).digest('hex') };
  });
  writeFileSync(join(directory, 'source-manifest.json'), JSON.stringify(manifest));
  const workspace = join(root, 'workspace');
  mkdirSync(join(workspace, 'src'), { recursive: true });
  writeFileSync(join(workspace, 'src/main.tsx'), 'concurrent workspace edit');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { workspace, baseline: { directory, sha: 'fixture-sha', sourceHash: 'fixture-hash' }, manifest };
}

test('controlled variants preserve baseline inputs despite concurrent workspace edits', (t) => {
  const { workspace, baseline, manifest } = fixture(t);
  const variant = freezeSource(workspace, { 'src/lib/consoleLogcatBridge.ts': 'bounded forwarder' }, baseline);
  t.after(() => rmSync(variant.directory, { recursive: true, force: true }));
  assert.equal(variant.sha, baseline.sha);
  assert.equal(readFileSync(join(variant.directory, 'src/main.tsx'), 'utf8'), 'baseline application');
  assert.equal(readFileSync(join(baseline.directory, 'src/lib/consoleLogcatBridge.ts'), 'utf8'), 'baseline forwarder');
  const changed = JSON.parse(readFileSync(join(variant.directory, 'source-manifest.json'), 'utf8'))
    .filter((entry) => entry.sha256 !== manifest.find((old) => old.path === entry.path).sha256);
  assert.deepEqual(changed.map((entry) => entry.path), ['src/lib/consoleLogcatBridge.ts']);
});

test('refuses a baseline whose recorded inputs have changed', (t) => {
  const { workspace, baseline } = fixture(t);
  writeFileSync(join(baseline.directory, 'src/main.tsx'), 'modified baseline');
  assert.throws(() => freezeSource(workspace, {}, baseline), /Frozen baseline source was modified: src\/main.tsx/);
});
