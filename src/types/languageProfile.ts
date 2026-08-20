/** Frontend contract for durable language-learning profiles. */

export type ProfileLifecycle = "active" | "archived" | "deleted";
export type AssociationMode = "auto" | "enabled" | "disabled";
export type ContentType = "document" | "media";

export interface ProfilePreferences {
  highlightDensity: "minimal" | "balanced" | "dense" | string;
  showTranslation: boolean;
  showExplanation: boolean;
  translationProvider: string;
  explanationProvider: string;
}

export interface ProcessingConfig {
  provider: string;
  offlineCapable: boolean;
  dictionaryEnabled: boolean;
  ttsEnabled: boolean;
  transcriptionEnabled: boolean;
}

export interface DetectionEvidence {
  language: string;
  confidence?: number;
  detector?: string;
  source?: string;
  detectedAt?: string;
}

export interface LanguageProfile {
  id: string;
  accountId: string;
  workspaceId: string;
  name: string;
  targetLanguage: string;
  baseLanguage: string;
  proficiency?: string;
  preferences: ProfilePreferences;
  processingConfig: ProcessingConfig;
  createdAt: string;
  updatedAt: string;
  lifecycle: ProfileLifecycle;
  version: number;
}

export interface LanguageProfileCreate {
  id?: string;
  accountId?: string;
  workspaceId?: string;
  name: string;
  targetLanguage: string;
  baseLanguage: string;
  proficiency?: string;
  preferences?: Partial<ProfilePreferences>;
  processingConfig?: Partial<ProcessingConfig>;
}

export interface LanguageProfileUpdate {
  name?: string;
  targetLanguage?: string;
  baseLanguage?: string;
  proficiency?: string;
  preferences?: Partial<ProfilePreferences>;
  processingConfig?: Partial<ProcessingConfig>;
  lifecycle?: ProfileLifecycle;
}

export interface LanguageProfileAssociation {
  id: string;
  accountId: string;
  workspaceId: string;
  profileId: string;
  contentType: ContentType;
  contentId: string;
  mode: AssociationMode;
  detectionEvidence?: DetectionEvidence;
  suggestionDismissed: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface LanguageProfileAssociationInput {
  id?: string;
  accountId?: string;
  workspaceId?: string;
  profileId: string;
  contentType: ContentType;
  contentId: string;
  mode: AssociationMode;
  detectionEvidence?: DetectionEvidence;
  suggestionDismissed?: boolean;
}

export interface ResolvedLanguageProfileContext {
  profile: LanguageProfile;
  association: LanguageProfileAssociation;
  source: "explicit_override" | "confirmed_association" | string;
  contextVersion: number;
}

export interface LanguageProfileSuggestion {
  profile: LanguageProfile;
  contentType: ContentType;
  contentId: string;
  evidence: DetectionEvidence;
}

export interface LanguageProfileScope {
  accountId: string;
  workspaceId: string;
}

export interface LanguageProfileExport {
  schemaVersion: number;
  scope: LanguageProfileScope;
  exportedAt: string;
  activeProfileId?: string;
  profiles: LanguageProfile[];
  associations: LanguageProfileAssociation[];
}

export interface LanguageProfileSyncEnvelope {
  schemaVersion: number;
  scope: LanguageProfileScope;
  changedAt: string;
  activeProfileId?: string;
  profiles: LanguageProfile[];
  associations: LanguageProfileAssociation[];
}

export interface ProfileDeleteReport {
  profileId: string;
  removedAssociations: number;
  removedProfileDerivedData: number;
  retainedDocuments: number;
  retainedLearningItems: number;
}

export const DEFAULT_LANGUAGE_PROFILE_SCOPE: LanguageProfileScope = {
  accountId: "local",
  workspaceId: "default",
};

export const DEFAULT_PROFILE_PREFERENCES: ProfilePreferences = {
  highlightDensity: "balanced",
  showTranslation: true,
  showExplanation: true,
  translationProvider: "local",
  explanationProvider: "local",
};

export const DEFAULT_PROFILE_PROCESSING_CONFIG: ProcessingConfig = {
  provider: "local",
  offlineCapable: true,
  dictionaryEnabled: true,
  ttsEnabled: true,
  transcriptionEnabled: true,
};

export function canonicalizeLanguageTag(value: string): string {
  const parts = value.trim().replaceAll("_", "-").split("-");
  return parts
    .map((part, index) => {
      if (index === 0) return part.toLowerCase();
      if (part.length === 4 && /^[a-z]+$/i.test(part)) {
        return part[0].toUpperCase() + part.slice(1).toLowerCase();
      }
      if ((part.length === 2 && /^[a-z]+$/i.test(part)) || /^\d{3}$/.test(part)) {
        return part.toUpperCase();
      }
      return part.toLowerCase();
    })
    .join("-");
}

export function isValidBcp47(value: string): boolean {
  const parts = value.trim().replaceAll("_", "-").split("-");
  if (!parts[0] || !/^[A-Za-z]{2,8}$/.test(parts[0])) return false;
  return parts.slice(1).every((part) => /^[A-Za-z0-9]{1,8}$/.test(part));
}
