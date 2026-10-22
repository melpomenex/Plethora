import { readdirSync, statSync } from "node:fs";
import path from "node:path";

/** Every .ts/.tsx under `dir`, so a key can be checked against its call site. */
export function sourceFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFilesUnder(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Literal translate calls with a quoted dotted key. The lookbehind keeps it to
 * the i18n `t`: it must not be preceded by an identifier char, `.` or `$`,
 * which excludes `format(`, `split(`, `Math.abs(`, `setTimeout(` and friends.
 */
const LITERAL_TRANSLATE_CALL = /(?<![A-Za-z0-9_$.])t\(\s*["']([A-Za-z0-9_.]+)["']/g;

/**
 * Distinct literal keys passed to `t()` in `source`. Non-literal keys
 * (variables, template strings, `t(prefix + suffix)`) are invisible to a grep
 * and remain unguarded.
 */
export function literalTranslateKeys(source: string): string[] {
  const seen = new Set<string>();
  for (const match of source.matchAll(LITERAL_TRANSLATE_CALL)) {
    seen.add(match[1]);
  }
  return [...seen];
}
