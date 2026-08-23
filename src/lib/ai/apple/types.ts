export type AppleFeatureStatus = "available" | "downloadable" | "downloading" | "unavailable";

export interface AppleFeatureState {
  status: AppleFeatureStatus;
  reason?: string;
}

export interface AppleIntelligenceSnapshot {
  appleOs: boolean;
  foundationModels: AppleFeatureState;
  foundationReason?: string;
  speech: AppleFeatureState;
  visionDocuments: AppleFeatureState;
  spotlightSemantic: AppleFeatureState;
  naturalLanguageEmbeddings: AppleFeatureState;
  coreAi: AppleFeatureState;
  checkedAt: number;
}

export function unavailableAppleFeature(reason: string): AppleFeatureState {
  return { status: "unavailable", reason };
}

export function unsupportedAppleSnapshot(checkedAt = 0): AppleIntelligenceSnapshot {
  const unsupported = unavailableAppleFeature("platform_unsupported");
  return {
    appleOs: false,
    foundationModels: unsupported,
    foundationReason: "platform_unsupported",
    speech: unsupported,
    visionDocuments: unsupported,
    spotlightSemantic: unsupported,
    naturalLanguageEmbeddings: unsupported,
    coreAi: unsupported,
    checkedAt,
  };
}
