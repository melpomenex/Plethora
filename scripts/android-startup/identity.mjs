import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, symlinkSync, statSync, chmodSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

/** Freeze tracked and untracked project inputs before any compiler runs. Shared
 * caches are linked; mobile builds do not consume desktop sidecar binaries. */
export function freezeSource(root, overrides = {}, baseline) {
  const directory = mkdtempSync(join(tmpdir(), 'plethora-startup-source-'));
  const sourceRoot = baseline?.directory ?? root;
  const sha = baseline?.sha ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const baselineManifest = baseline
    ? JSON.parse(readFileSync(join(sourceRoot, 'source-manifest.json'), 'utf8')) : [];
  const expectedHashes = new Map(baselineManifest.map((entry) => [entry.path, entry.sha256]));
  const paths = baseline
    ? baselineManifest.map((entry) => entry.path)
    : [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
      .split('\0').filter((p) => p && !p.startsWith('src-tauri/bin/') && !/(^|\/)(target|build|node_modules|\.gradle)\//.test(p)))].sort();
  const hash = createHash('sha256');
  const manifest = [];
  for (const path of paths) {
    // Another chat may have removed a file between inventory and snapshot.
    let stat;
    try { stat = statSync(join(sourceRoot, path)); } catch (error) {
      if (baseline) throw error;
      continue;
    }
    if (!stat.isFile()) continue;
    const dest = join(directory, path);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(sourceRoot, path), dest); chmodSync(dest, stat.mode);
    if (baseline && createHash('sha256').update(readFileSync(dest)).digest('hex') !== expectedHashes.get(path)) {
      throw new Error(`Frozen baseline source was modified: ${path}; rebuild a matched baseline`);
    }
    if (Object.hasOwn(overrides, path)) writeFileSync(dest, overrides[path]);
    const bytes = readFileSync(dest);
    const digest = createHash('sha256').update(bytes).digest('hex');
    manifest.push({ path, sha256: digest });
    hash.update(path + '\0' + digest + '\0');
  }
  symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'));
  symlinkSync(join(root, 'src-tauri/bin'), join(directory, 'src-tauri/bin'));
  symlinkSync(join(root, 'src-tauri/target'), join(directory, 'src-tauri/target'));
  writeFileSync(join(directory, 'source-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { directory, sha, sourceHash: hash.digest('hex') };
}
