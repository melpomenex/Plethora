import { browserInvoke } from "../lib/browser-backend";
import { invokeCommand, isTauri } from "../lib/tauri";
import {
  DEFAULT_LANGUAGE_PROFILE_SCOPE,
  DEFAULT_PROFILE_PREFERENCES,
  DEFAULT_PROFILE_PROCESSING_CONFIG,
  type ContentType,
  type DetectionEvidence,
  type LanguageProfile,
  type LanguageProfileAssociation,
  type LanguageProfileAssociationInput,
  type LanguageProfileCreate,
  type LanguageProfileExport,
  type LanguageProfileScope,
  type LanguageProfileSuggestion,
  type LanguageProfileSyncEnvelope,
  type LanguageProfileUpdate,
  type ProcessingConfig,
  type ProfileDeleteReport,
  type ResolvedLanguageProfileContext,
} from "../types/languageProfile";

type ProfileCall = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
const call: ProfileCall = (command, args) =>
  isTauri() ? invokeCommand(command, args) : browserInvoke(command, args);

function scopeArgs(scope?: Partial<LanguageProfileScope>): Record<string, string> {
  return {
    accountId: scope?.accountId || DEFAULT_LANGUAGE_PROFILE_SCOPE.accountId,
    workspaceId: scope?.workspaceId || DEFAULT_LANGUAGE_PROFILE_SCOPE.workspaceId,
  };
}

function createPayload(input: LanguageProfileCreate, scope?: Partial<LanguageProfileScope>) {
  return {
    input: {
      ...input,
      ...scopeArgs(scope),
      preferences: { ...DEFAULT_PROFILE_PREFERENCES, ...input.preferences },
      processingConfig: { ...DEFAULT_PROFILE_PROCESSING_CONFIG, ...input.processingConfig },
    },
    ...scopeArgs(scope),
  };
}

export function createLanguageProfile(
  input: LanguageProfileCreate,
  scope?: Partial<LanguageProfileScope>,
): Promise<LanguageProfile> {
  return call<LanguageProfile>("create_language_profile", createPayload(input, scope));
}

export function getLanguageProfiles(scope?: Partial<LanguageProfileScope>): Promise<LanguageProfile[]> {
  return call<LanguageProfile[]>("get_language_profiles", scopeArgs(scope));
}

export function getLanguageProfile(id: string, scope?: Partial<LanguageProfileScope>): Promise<LanguageProfile | null> {
  return call<LanguageProfile | null>("get_language_profile", { id, ...scopeArgs(scope) });
}

export function updateLanguageProfile(
  id: string,
  input: LanguageProfileUpdate,
  scope?: Partial<LanguageProfileScope>,
): Promise<LanguageProfile> {
  return call<LanguageProfile>("update_language_profile", { id, input, ...scopeArgs(scope) });
}

export function archiveLanguageProfile(id: string, scope?: Partial<LanguageProfileScope>): Promise<LanguageProfile> {
  return call<LanguageProfile>("archive_language_profile", { id, ...scopeArgs(scope) });
}

export function deleteLanguageProfile(id: string, scope?: Partial<LanguageProfileScope>): Promise<ProfileDeleteReport> {
  return call<ProfileDeleteReport>("delete_language_profile", { id, ...scopeArgs(scope) });
}

export function getActiveLanguageProfile(scope?: Partial<LanguageProfileScope>): Promise<LanguageProfile | null> {
  return call<LanguageProfile | null>("get_active_language_profile", scopeArgs(scope));
}

export function setActiveLanguageProfile(
  profileId: string | null,
  scope?: Partial<LanguageProfileScope>,
): Promise<LanguageProfile | null> {
  return call<LanguageProfile | null>("set_active_language_profile", { profileId, ...scopeArgs(scope) });
}

export function associateLanguageProfileContent(
  input: LanguageProfileAssociationInput,
  scope?: Partial<LanguageProfileScope>,
): Promise<LanguageProfileAssociation> {
  return call<LanguageProfileAssociation>("associate_language_profile_content", {
    input: { ...input, ...scopeArgs(scope) },
    ...scopeArgs(scope),
  });
}

export function getLanguageProfileAssociations(
  filters: { contentType?: ContentType; contentId?: string; profileId?: string } = {},
  scope?: Partial<LanguageProfileScope>,
): Promise<LanguageProfileAssociation[]> {
  return call<LanguageProfileAssociation[]>("get_language_profile_associations", {
    ...filters,
    ...scopeArgs(scope),
  });
}

export function resolveLanguageProfileContext(
  contentType: ContentType,
  contentId: string,
  explicitProfileId?: string | null,
  scope?: Partial<LanguageProfileScope>,
): Promise<ResolvedLanguageProfileContext | null> {
  return call<ResolvedLanguageProfileContext | null>("resolve_language_profile_context", {
    contentType,
    contentId,
    explicitProfileId: explicitProfileId || null,
    ...scopeArgs(scope),
  });
}

export function getLanguageProfileSuggestion(
  contentType: ContentType,
  contentId: string,
  evidence: DetectionEvidence,
  scope?: Partial<LanguageProfileScope>,
): Promise<LanguageProfileSuggestion | null> {
  return call<LanguageProfileSuggestion | null>("get_language_profile_suggestion", {
    contentType,
    contentId,
    evidence,
    ...scopeArgs(scope),
  });
}

export function dismissLanguageProfileSuggestion(
  profileId: string,
  contentType: ContentType,
  contentId: string,
  evidence?: DetectionEvidence,
  scope?: Partial<LanguageProfileScope>,
): Promise<LanguageProfileAssociation> {
  return call<LanguageProfileAssociation>("dismiss_language_profile_suggestion", {
    profileId,
    contentType,
    contentId,
    evidence: evidence || null,
    ...scopeArgs(scope),
  });
}

export function exportLanguageProfiles(scope?: Partial<LanguageProfileScope>): Promise<LanguageProfileExport> {
  return call<LanguageProfileExport>("export_language_profiles", scopeArgs(scope));
}

export function importLanguageProfiles(
  payload: LanguageProfileExport,
  conflict: "merge" | "replace" = "merge",
  scope?: Partial<LanguageProfileScope>,
): Promise<LanguageProfileExport> {
  return call<LanguageProfileExport>("import_language_profiles", { payload, conflict, ...scopeArgs(scope) });
}

export function serializeLanguageProfilesForSync(scope?: Partial<LanguageProfileScope>): Promise<LanguageProfileSyncEnvelope> {
  return call<LanguageProfileSyncEnvelope>("serialize_language_profiles_for_sync", scopeArgs(scope));
}

export function applyLanguageProfilesSync(
  payload: LanguageProfileSyncEnvelope,
  scope?: Partial<LanguageProfileScope>,
): Promise<LanguageProfileSyncEnvelope> {
  return call<LanguageProfileSyncEnvelope>("apply_language_profiles_sync", { payload, ...scopeArgs(scope) });
}

export type { ProcessingConfig };
