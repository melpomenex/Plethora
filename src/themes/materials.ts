/** Finite application-owned materials: imported theme data never supplies URLs. */
export const PAPER_PRESET_ID = "legal-pad-archival-v1" as const;
export type PaperPresetId = typeof PAPER_PRESET_ID;
export type PaperDetail = "subtle" | "authentic" | "maximum";
export interface PaperMaterial {
  kind: "paper";
  preset: PaperPresetId;
}
export interface PaperPreferences {
  detail: PaperDetail;
  ruling: boolean;
  margin: boolean;
}
export type MaterialPreferences = Partial<Record<PaperPresetId, PaperPreferences>>;
export const DEFAULT_PAPER_PREFERENCES: Readonly<PaperPreferences> = Object.freeze({
  detail: "authentic",
  ruling: true,
  margin: true,
});

export function normalizePaperPreferences(value: unknown): PaperPreferences {
  const input = value && typeof value === "object" ? (value as Partial<PaperPreferences>) : {};
  return {
    detail: ["subtle", "authentic", "maximum"].includes(input.detail) ? input.detail : "authentic",
    ruling: typeof input.ruling === "boolean" ? input.ruling : true,
    margin: typeof input.margin === "boolean" ? input.margin : true,
  };
}

export function normalizeMaterialPreferences(value: unknown): MaterialPreferences {
  if (!value || typeof value !== "object" || !(PAPER_PRESET_ID in value)) return {};
  return { [PAPER_PRESET_ID]: normalizePaperPreferences(value[PAPER_PRESET_ID]) };
}

export function normalizeThemeMaterial(value: unknown): PaperMaterial | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Partial<PaperMaterial>;
  return input.kind === "paper" && input.preset === PAPER_PRESET_ID
    ? { kind: "paper", preset: PAPER_PRESET_ID }
    : undefined;
}
