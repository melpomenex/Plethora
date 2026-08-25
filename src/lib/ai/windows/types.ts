export type WindowsFeatureStatus = "available" | "downloadable" | "downloading" | "unavailable";

export interface WindowsFeatureState {
  status: WindowsFeatureStatus;
  reason?: string;
}

export interface WindowsIntelligenceSnapshot {
  windowsOs: boolean;
  packageIdentity?: string | null;
  languageModel: WindowsFeatureState;
  ocr: WindowsFeatureState;
  imageDescription: WindowsFeatureState;
  embeddings: WindowsFeatureState;
  checkedAt: number;
}

/** Extended probe from `windows_lm_diagnostics` for hardware validation. */
export interface WindowsLmDiagnostics {
  windowsOs?: boolean;
  packageIdentity?: string | null;
  languageModel?: WindowsFeatureState;
  ocr?: WindowsFeatureState;
  osMeetsMinimum?: boolean;
  phiBridgeAvailable?: boolean;
  phiReadyState?: number | null;
  lafTokenConfigured?: boolean;
  lafAttestationConfigured?: boolean;
  ocrReadyState?: number | null;
  sparseMsixCandidates?: string[];
  checkedAt?: number;
  platform?: string;
  reason?: string;
}

export function unavailableWindowsFeature(reason: string): WindowsFeatureState {
  return { status: "unavailable", reason };
}

export function unsupportedWindowsSnapshot(checkedAt = 0): WindowsIntelligenceSnapshot {
  const unsupported = unavailableWindowsFeature("platform_unsupported");
  return {
    windowsOs: false,
    packageIdentity: null,
    languageModel: unsupported,
    ocr: unsupported,
    imageDescription: unsupported,
    embeddings: unsupported,
    checkedAt,
  };
}
