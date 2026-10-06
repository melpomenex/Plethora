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

/** EmbeddingGemma 2 stays on the existing genai downloader in v1 (not Play AI packs). */
export const EMBEDDING_GEMMA_LICENSE: ModelLicenseRecord = {
  id: "embeddinggemma",
  displayName: "EmbeddingGemma 2 (270M)",
  license: "apache-2.0",
  installTime: false,
  sizeBytes: 168_000_000,
  allowedOnTier: ["embed", "gen"],
};

export const EMBEDDING_GEMMA_VISION_LICENSE: ModelLicenseRecord = {
  id: "embeddinggemma-vision",
  displayName: "EmbeddingGemma 2 Vision (440M)",
  license: "apache-2.0",
  installTime: false,
  sizeBytes: 280_000_000,
  allowedOnTier: ["embed", "gen"],
};

export const EMBEDDING_GEMMA_MULTIMODAL_DESKTOP_LICENSE: ModelLicenseRecord = {
  id: "embeddinggemma-multimodal",
  displayName: "EmbeddingGemma 2 Multimodal (740M)",
  license: "apache-2.0",
  installTime: false,
  sizeBytes: 520_000_000,
  allowedOnTier: ["embed", "gen"],
};

const REGISTRY: ModelLicenseRecord[] = [
  EMBEDDING_GEMMA_LICENSE,
  EMBEDDING_GEMMA_VISION_LICENSE,
  EMBEDDING_GEMMA_MULTIMODAL_DESKTOP_LICENSE,
];

export function listLicensedModels(): readonly ModelLicenseRecord[] {
  return REGISTRY;
}

export function findLicensedModel(id: string): ModelLicenseRecord | undefined {
  return REGISTRY.find((row) => row.id === id);
}

export function mayShipGenerativePack(record: ModelLicenseRecord | undefined): boolean {
  return Boolean(record && record.license !== "unlicensed" && !record.installTime);
}
