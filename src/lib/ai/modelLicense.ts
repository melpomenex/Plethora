/**
 * Provenance registry for optional Plethora-managed models (OpenSpec H).
 * No concrete generative LLM is selected until a license is recorded.
 */

export type ModelLicenseKind = "apache-2.0" | "mit" | "bsd" | "custom" | "unlicensed";

export interface ModelLicenseRecord {
  id: string;
  displayName: string;
  license: ModelLicenseKind;
  licenseUrl?: string;
  sourceUrl?: string;
  sha256?: string;
  sizeBytes?: number;
  /** Generative packs must stay on-demand; never install-time. */
  installTime: boolean;
  allowedOnTier: readonly ("embed" | "gen")[];
}

/** EmbeddingGemma stays on the existing genai downloader in v1 (not Play AI packs). */
export const EMBEDDING_GEMMA_LICENSE: ModelLicenseRecord = {
  id: "embeddinggemma",
  displayName: "EmbeddingGemma",
  license: "apache-2.0",
  installTime: false,
  sizeBytes: 184_000_000,
  allowedOnTier: ["embed", "gen"],
};

const REGISTRY: ModelLicenseRecord[] = [EMBEDDING_GEMMA_LICENSE];

export function listLicensedModels(): readonly ModelLicenseRecord[] {
  return REGISTRY;
}

export function findLicensedModel(id: string): ModelLicenseRecord | undefined {
  return REGISTRY.find((row) => row.id === id);
}

export function mayShipGenerativePack(record: ModelLicenseRecord | undefined): boolean {
  return Boolean(record && record.license !== "unlicensed" && !record.installTime);
}
