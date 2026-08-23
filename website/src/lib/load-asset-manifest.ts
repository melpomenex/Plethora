import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARKETING_ASSETS, type MarketingAssetManifest } from '../config/assets.ts';

/**
 * Read the checked-in manifest from the website package, not process.cwd().
 * `npm run website:dev` from the repo root otherwise misses the JSON and
 * the homepage collage stays on “screenshot pending”.
 */
export function loadAssetManifest(): MarketingAssetManifest {
  const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const candidates = [
    resolve(websiteRoot, 'src/config/asset-manifest.json'),
    resolve(websiteRoot, '../marketing/asset-manifest.json'),
  ];

  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as MarketingAssetManifest;
    } catch {
      continue;
    }
  }

  return MARKETING_ASSETS;
}
