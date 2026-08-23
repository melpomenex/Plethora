export interface ChangelogEntry {
  version: string;
  date: string | null;
  body: string;
}

const HEADING = /^## \[([^\]]+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?\s*$/;

export function parseChangelog(markdown: string, options?: { minVersion?: string; limit?: number }): ChangelogEntry[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;
  const body: string[] = [];

  const flush = () => {
    if (!current) return;
    current.body = body.join('\n').trim();
    body.length = 0;
    if (current.body.length > 0) entries.push(current);
    current = null;
  };

  for (const line of lines) {
    const match = line.match(HEADING);
    if (match) {
      flush();
      current = { version: match[1], date: match[2] ?? null, body: '' };
      continue;
    }
    if (current) body.push(line);
  }
  flush();

  let filtered = entries;
  if (options?.minVersion) {
    filtered = filtered.filter((entry) => compareSemver(entry.version, options.minVersion!) >= 0);
  }
  if (options?.limit) {
    filtered = filtered.slice(0, options.limit);
  }
  return filtered;
}

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    const delta = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}
