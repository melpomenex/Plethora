#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const activePath = join(websiteRoot, 'src/config/showcase-v2-active.json');
const catalogPath = join(websiteRoot, 'src/config/showcase-scenes-v2.json');
const budgetsPath = join(websiteRoot, 'scripts/showcase-budgets.json');

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

export function checkShowcaseAssets() {
  const errors = [];
  const active = JSON.parse(readFileSync(activePath, 'utf8'));
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const budgets = JSON.parse(readFileSync(budgetsPath, 'utf8'));
  if (active.approved !== true || active.placeholder !== false) {
    errors.push('active showcase policy is not approved and non-placeholder');
  }
  if (!String(active.assetManifestPath).startsWith('/images/showcase/v2/')) {
    errors.push('active asset manifest points outside /images/showcase/v2');
  }

  const manifestPath = resolve(websiteRoot, 'public', String(active.assetManifestPath).replace(/^\//, ''));
  if (!existsSync(manifestPath)) {
    return { ok: false, errors: [...errors, `active asset manifest missing: ${manifestPath}`] };
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const key of ['catalogId', 'fixtureVersion', 'fixtureHash', 'theme']) {
    if (manifest.metadata?.[key] !== active[key] || catalog.metadata?.[key] !== active[key]) {
      errors.push(`${key} does not match active policy, catalog, and manifest`);
    }
  }
  if (manifest.metadata?.buildId !== active.buildId) {
    errors.push('buildId does not match the active policy and manifest');
  }

  const bySceneLayout = new Map(
    (manifest.assets ?? []).map((asset) => [`${asset.sceneId}:${asset.layout}`, asset]),
  );
  for (const sceneId of catalog.guidedPath ?? []) {
    for (const layout of ['desktop', 'mobile']) {
      if (!bySceneLayout.has(`${sceneId}:${layout}`)) {
        errors.push(`required asset missing: ${sceneId}/${layout}`);
      }
    }
  }

  const files = new Set();
  for (const asset of manifest.assets ?? []) {
    if (
      asset.fixtureVersion !== active.fixtureVersion ||
      asset.fixtureHash !== active.fixtureHash ||
      asset.gitSha !== active.gitSha ||
      asset.theme !== active.theme ||
      asset.sourceType !== active.sourceType
    ) {
      errors.push(`${asset.sceneId}/${asset.layout} provenance violates active policy`);
    }
    if (!asset.accessibleDescription || !asset.intrinsicSize?.width || !asset.intrinsicSize?.height) {
      errors.push(`${asset.sceneId}/${asset.layout} lacks description or intrinsic dimensions`);
    }
    for (const format of ['avif', 'webp', 'png']) {
      for (const source of asset.formats?.[format] ?? []) {
        if (!String(source.path).startsWith(`${active.assetBasePath}/`)) {
          errors.push(`${asset.sceneId}/${asset.layout} ${format} path is outside the active set`);
          continue;
        }
        const file = resolve(websiteRoot, 'public', String(source.path).replace(/^\//, ''));
        if (!existsSync(file)) {
          errors.push(`asset file missing: ${source.path}`);
          continue;
        }
        files.add(file);
        const bytes = statSync(file).size;
        if (bytes > budgets.maxIndividualAssetBytes) {
          errors.push(`${source.path} is ${bytes} bytes, over ${budgets.maxIndividualAssetBytes}`);
        }
        if (sha256(file) !== source.sha256) errors.push(`asset hash mismatch: ${source.path}`);
      }
    }
  }

  const totalBytes = [...files].reduce((total, file) => total + statSync(file).size, 0);
  if (totalBytes > budgets.maxVersionedAssetSetBytes) {
    errors.push(`showcase set is ${totalBytes} bytes, over ${budgets.maxVersionedAssetSetBytes}`);
  }

  // Hero transfer caps (refine-useplethora-visual-product-storytelling D11):
  // per-image cap on the largest above-the-fold source and a total cap for
  // everything the homepage hero loads eagerly.
  const basePath = String(active.assetBasePath);
  for (const [name, cap] of Object.entries(budgets.perImageCaps ?? {})) {
    const file = resolve(websiteRoot, 'public', basePath.replace(/^\//, ''), name);
    if (!existsSync(file)) continue; // variant absent from this set (e.g. 480 pending)
    const bytes = statSync(file).size;
    if (bytes > cap) {
      errors.push(`${name} is ${bytes} bytes, over the ${cap}-byte hero cap`);
    }
  }
  if (Array.isArray(budgets.aboveTheFoldImages) && Number.isFinite(budgets.maxAboveTheFoldBytes)) {
    let foldBytes = 0;
    let missing = 0;
    for (const name of budgets.aboveTheFoldImages) {
      const file = resolve(websiteRoot, 'public', basePath.replace(/^\//, ''), name);
      if (!existsSync(file)) {
        missing += 1;
        continue;
      }
      foldBytes += statSync(file).size;
    }
    if (missing === 0 && foldBytes > budgets.maxAboveTheFoldBytes) {
      errors.push(
        `above-the-fold hero images total ${foldBytes} bytes, over ${budgets.maxAboveTheFoldBytes}`,
      );
    }
  }
  return { ok: errors.length === 0, errors, totalBytes, fileCount: files.size };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = checkShowcaseAssets();
  if (!result.ok) {
    console.error(result.errors.join('\n'));
    process.exit(1);
  }
  console.log(`check:showcase-assets: ${result.fileCount} files, ${result.totalBytes} bytes`);
}
