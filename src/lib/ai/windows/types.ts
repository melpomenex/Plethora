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
  /** @deprecated Superseded by `sparseIdentity`, which carries the same paths plus the last registration outcome. */
  sparseMsixCandidates?: string[];
  /** Sparse identity package state: candidate paths and the last registration attempt. */
  sparseIdentity?: WindowsSparseIdentityDiagnostics;
  checkedAt?: number;
  platform?: string;
  reason?: string;
}

/** Outcome of the last sparse identity registration attempt (`windows_lm_diagnostics`). */
export interface WindowsSparseIdentityDiagnostics {
  packageName?: string;
  candidates?: string[];
  lastAttempt?: {
    /** Whether PowerShell was actually invoked. */
    attempted?: boolean;
    outcome?: "registered" | "already_registered" | "skipped" | "failed";
    /** Why no attempt happened (only for `skipped`). */
    skippedReason?: string;
    msixPath?: string;
    externalLocation?: string;
    /** Windows error code, e.g. `0x800B0109` for an untrusted certificate. */
    errorCode?: string;
    errorMessage?: string;
  } | null;
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
