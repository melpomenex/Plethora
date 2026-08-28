/**
 * Store-profile artifact guard (Change A §3.3).
 *
 * When PLETHORA_BUILD_PROFILE=store, the production frontend build MUST fail
 * if dev/test-only artifacts leak into the emitted bundle: dev server URLs,
 * loopback endpoints, or devtools flags. The Vite config wires this into a
 * writeBundle hook; the pure scanner lives here so the invariant is unit
 * tested without running a build.
 */

import { PLETHORA_LEGACY_API_URL } from "../config/apiUrl";

export const FORBIDDEN_STORE_ARTIFACT_PATTERNS: readonly { pattern: RegExp; reason: string }[] = [
  { pattern: /https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/gi, reason: "dev/loopback HTTP endpoint" },
  { pattern: /wss?:\/\/(localhost|127\.0\.0\.1|\[::1\])/gi, reason: "dev/loopback WebSocket endpoint" },
  {
    pattern: new RegExp(PLETHORA_LEGACY_API_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
    reason: "obsolete provisional API domain (use api.useplethora.com)",
  },
];

/** Returns a violation list (empty = clean). */
export function scanForForbiddenStoreArtifacts(code: string, fileName = "<bundle>"): string[] {
  const violations: string[] = [];
  for (const { pattern, reason } of FORBIDDEN_STORE_ARTIFACT_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(code)) !== null) {
      const line = code.slice(0, match.index).split("\n").length;
      violations.push(`${fileName}:${line}: ${reason} (${match[0]})`);
      if (match[0].length === 0) re.lastIndex++;
    }
  }
  return violations;
}
