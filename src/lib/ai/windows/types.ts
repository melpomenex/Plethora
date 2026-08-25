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
