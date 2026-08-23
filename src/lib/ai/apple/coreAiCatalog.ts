/**
 * Core AI catalog gates (OpenSpec H). Network fetch is skipped when the
 * feature flag is off. Conversion of weights to `.aimodel` happens out of
 * app — see docs/product/features/platform/apple-core-ai-packaging.md.
 */

export const CORE_AI_PACKAGE_FORMAT = "aimodel-27";
export const CORE_AI_MAX_BYTES = 8 * 1024 * 1024 * 1024;
export const CORE_AI_DISK_MARGIN_BYTES = 512 * 1024 * 1024;
export const CORE_AI_IPHONE_INSTALL_WARN_BYTES = 1.5 * 1024 * 1024 * 1024;
export const CORE_AI_POST_INSTALL_FLOOR_BYTES = 1024 * 1024 * 1024;

export interface CoreAICatalogEntry {
  modelId: string;
  version: string;
  packageFormat: string;
  url: string;
  sha256: string;
  byteSize: number;
  installSizeBytes: number;
  minOs: string;
  ramRecommendedMb: number;
  license: { spdx: string; name?: string };
  capabilities?: string[];
}

export interface CoreAICatalog {
  version: number;
  entries: CoreAICatalogEntry[];
}

export type DiskGateReason =
  | "ok"
  | "hard_cap"
  | "insufficient_disk"
  | "unknown_format"
  | "iphone_large_warn";

export function parseCoreAiCatalog(raw: unknown): CoreAICatalog {
  if (!raw || typeof raw !== "object") {
    throw new Error("invalid_catalog");
  }
  const obj = raw as { version?: number; entries?: unknown };
  if (!Array.isArray(obj.entries)) throw new Error("invalid_catalog");
  const entries = obj.entries.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("invalid_catalog");
    const e = entry as CoreAICatalogEntry;
    if (!e.modelId || !e.version || !e.sha256 || !e.url) throw new Error("invalid_catalog");
    if (e.packageFormat !== CORE_AI_PACKAGE_FORMAT) {
      throw new Error("unknown_format");
    }
    return e;
  });
  return { version: obj.version ?? 1, entries };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyCatalogBytes(
  catalogJson: string,
  expectedSha256: string,
): Promise<boolean> {
  const hash = await sha256Hex(new TextEncoder().encode(catalogJson));
  return hash === expectedSha256.toLowerCase();
}

export function evaluateDiskGate(input: {
  byteSize: number;
  installSizeBytes: number;
  freeBytes: number;
  iphone?: boolean;
}): { ok: boolean; reason: DiskGateReason } {
  if (input.byteSize > CORE_AI_MAX_BYTES) {
    return { ok: false, reason: "hard_cap" };
  }
  if (input.freeBytes < input.installSizeBytes + CORE_AI_DISK_MARGIN_BYTES) {
    return { ok: false, reason: "insufficient_disk" };
  }
  const remaining = input.freeBytes - input.installSizeBytes;
  if (remaining < CORE_AI_POST_INSTALL_FLOOR_BYTES) {
    return { ok: false, reason: "insufficient_disk" };
  }
  if (input.iphone && input.installSizeBytes > CORE_AI_IPHONE_INSTALL_WARN_BYTES) {
    return { ok: true, reason: "iphone_large_warn" };
  }
  return { ok: true, reason: "ok" };
}

export function evaluateMemoryGate(
  ramRecommendedMb: number,
  budgetMb: number,
): { ok: boolean; reason: "ok" | "insufficient_memory" } {
  if (ramRecommendedMb > budgetMb) {
    return { ok: false, reason: "insufficient_memory" };
  }
  return { ok: true, reason: "ok" };
}
