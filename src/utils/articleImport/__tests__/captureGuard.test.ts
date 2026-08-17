/**
 * Guard: the rendered-capture desktop window label `article-capture-*` must
 * NEVER be granted a capability. The capture window loads remote pages; if a
 * capability ever matched its label, the loaded page would gain Tauri API
 * access. See design D5 and rendered-page-fallback spec.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const capabilitiesDir = join(here, '..', '..', '..', '..', 'src-tauri', 'capabilities');

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

describe('rendered-capture window isolation', () => {
  it('capabilities exist to inspect', () => {
    const files = readdirSync(capabilitiesDir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);
  });

  it('no capability window/webview entry matches an article-capture-* label', () => {
    const files = readdirSync(capabilitiesDir).filter((f) => f.endsWith('.json'));
    const probeLabels = ['article-capture-0', 'article-capture-123456789012345678', 'article-capture-xyz'];
    for (const file of files) {
      const cap = JSON.parse(readFileSync(join(capabilitiesDir, file), 'utf-8')) as {
        windows?: string[];
        webviews?: string[];
      };
      const entries = [...(cap.windows ?? []), ...(cap.webviews ?? [])];
      for (const entry of entries) {
        const rx = globToRegExp(entry);
        for (const label of probeLabels) {
          expect(rx.test(label), `${file} entry "${entry}" must not match "${label}"`).toBe(false);
        }
      }
    }
  });

  it('the desktop capture command names its windows article-capture-*', async () => {
    const source = readFileSync(
      join(here, '..', '..', '..', '..', 'src-tauri', 'src', 'commands', 'article_capture.rs'),
      'utf-8'
    );
    expect(source).toContain('format!("article-capture-{}"');
  });
});
