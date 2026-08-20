import { create } from "zustand";
import * as languageProfilesApi from "../api/languageProfiles";
import type {
  AssociationMode,
  ContentType,
  DetectionEvidence,
  LanguageProfile,
  LanguageProfileAssociation,
  LanguageProfileCreate,
  LanguageProfileScope,
  LanguageProfileSuggestion,
  LanguageProfileUpdate,
  ProfileDeleteReport,
  ResolvedLanguageProfileContext,
} from "../types/languageProfile";

interface LanguageProfileState {
  scope: LanguageProfileScope;
  profiles: LanguageProfile[];
  activeProfileId: string | null;
  activeProfile: LanguageProfile | null;
  associations: LanguageProfileAssociation[];
  suggestions: Record<string, LanguageProfileSuggestion | null>;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  projectionEpoch: number;

  setScope: (scope: LanguageProfileScope) => Promise<void>;
  load: (scope?: Partial<LanguageProfileScope>) => Promise<void>;
  createProfile: (input: LanguageProfileCreate) => Promise<LanguageProfile>;
  updateProfile: (id: string, input: LanguageProfileUpdate) => Promise<LanguageProfile>;
  archiveProfile: (id: string) => Promise<LanguageProfile>;
  deleteProfile: (id: string) => Promise<ProfileDeleteReport>;
  setActiveProfile: (id: string | null) => Promise<void>;
  associateContent: (input: {
    profileId: string;
    contentType: ContentType;
    contentId: string;
    mode: AssociationMode;
    detectionEvidence?: DetectionEvidence;
    suggestionDismissed?: boolean;
  }) => Promise<LanguageProfileAssociation>;
  getAssociations: (contentType: ContentType, contentId: string) => Promise<LanguageProfileAssociation[]>;
  resolveContext: (contentType: ContentType, contentId: string, explicitProfileId?: string | null) => Promise<ResolvedLanguageProfileContext | null>;
  loadSuggestion: (contentType: ContentType, contentId: string, evidence: DetectionEvidence) => Promise<LanguageProfileSuggestion | null>;
  dismissSuggestion: (suggestion: LanguageProfileSuggestion) => Promise<void>;
  invalidateProfileProjections: () => void;
}

const DEFAULT_SCOPE: LanguageProfileScope = { accountId: "local", workspaceId: "default" };
const suggestionKey = (contentType: ContentType, contentId: string) => `${contentType}:${contentId}`;

export const useLanguageProfileStore = create<LanguageProfileState>()((set, get) => ({
  scope: DEFAULT_SCOPE,
  profiles: [],
  activeProfileId: null,
  activeProfile: null,
  associations: [],
  suggestions: {},
  loaded: false,
  loading: false,
  error: null,
  projectionEpoch: 0,

  setScope: async (scope) => {
    if (scope.accountId === get().scope.accountId && scope.workspaceId === get().scope.workspaceId && get().loaded) return;
    set({ scope, loaded: false, profiles: [], associations: [], activeProfile: null, activeProfileId: null });
    await get().load(scope);
  },

  load: async (scope) => {
    const nextScope = {
      accountId: scope?.accountId || get().scope.accountId,
      workspaceId: scope?.workspaceId || get().scope.workspaceId,
    };
    set({ loading: true, error: null, scope: nextScope });
    try {
      const [profiles, activeProfile] = await Promise.all([
        languageProfilesApi.getLanguageProfiles(nextScope),
        languageProfilesApi.getActiveLanguageProfile(nextScope),
      ]);
      set({
        profiles,
        activeProfile,
        activeProfileId: activeProfile?.id ?? null,
        loaded: true,
        loading: false,
        error: null,
        associations: [],
        suggestions: {},
      });
    } catch (error) {
      set({ loaded: true, loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  createProfile: async (input) => {
    const profile = await languageProfilesApi.createLanguageProfile(input, get().scope);
    set((state) => ({ profiles: [profile, ...state.profiles.filter((value) => value.id !== profile.id)] }));
    return profile;
  },

  updateProfile: async (id, input) => {
    const profile = await languageProfilesApi.updateLanguageProfile(id, input, get().scope);
    set((state) => ({
      profiles: state.profiles.map((value) => (value.id === id ? profile : value)),
      activeProfile: state.activeProfile?.id === id ? profile : state.activeProfile,
    }));
    get().invalidateProfileProjections();
    return profile;
  },

  archiveProfile: async (id) => {
    const profile = await languageProfilesApi.archiveLanguageProfile(id, get().scope);
    set((state) => ({ profiles: state.profiles.map((value) => (value.id === id ? profile : value)), activeProfile: state.activeProfile?.id === id ? null : state.activeProfile, activeProfileId: state.activeProfileId === id ? null : state.activeProfileId }));
    get().invalidateProfileProjections();
    return profile;
  },

  deleteProfile: async (id) => {
    const report = await languageProfilesApi.deleteLanguageProfile(id, get().scope);
    set((state) => ({
      profiles: state.profiles.filter((value) => value.id !== id),
      associations: state.associations.filter((value) => value.profileId !== id),
      activeProfile: state.activeProfile?.id === id ? null : state.activeProfile,
      activeProfileId: state.activeProfileId === id ? null : state.activeProfileId,
    }));
    get().invalidateProfileProjections();
    return report;
  },

  setActiveProfile: async (id) => {
    const activeProfile = await languageProfilesApi.setActiveLanguageProfile(id, get().scope);
    set({ activeProfile, activeProfileId: activeProfile?.id ?? null });
    get().invalidateProfileProjections();
  },

  associateContent: async (input) => {
    const association = await languageProfilesApi.associateLanguageProfileContent(input, get().scope);
    set((state) => ({
      associations: [
        association,
        ...state.associations.filter((value) => !(value.profileId === association.profileId && value.contentType === association.contentType && value.contentId === association.contentId)),
      ],
      suggestions: { ...state.suggestions, [suggestionKey(association.contentType, association.contentId)]: null },
    }));
    get().invalidateProfileProjections();
    return association;
  },

  getAssociations: async (contentType, contentId) => {
    const associations = await languageProfilesApi.getLanguageProfileAssociations({ contentType, contentId }, get().scope);
    set((state) => ({
      associations: [
        ...associations,
        ...state.associations.filter((value) => !(value.contentType === contentType && value.contentId === contentId)),
      ],
    }));
    return associations;
  },

  resolveContext: (contentType, contentId, explicitProfileId) =>
    languageProfilesApi.resolveLanguageProfileContext(contentType, contentId, explicitProfileId, get().scope),

  loadSuggestion: async (contentType, contentId, evidence) => {
    const key = suggestionKey(contentType, contentId);
    if (Object.prototype.hasOwnProperty.call(get().suggestions, key)) return get().suggestions[key] ?? null;
    try {
      const suggestion = await languageProfilesApi.getLanguageProfileSuggestion(contentType, contentId, evidence, get().scope);
      set((state) => ({ suggestions: { ...state.suggestions, [key]: suggestion } }));
      return suggestion;
    } catch (error) {
      // Detection/provider failures are recoverable; ordinary reading must not
      // be blocked by them.
      console.warn("Language profile suggestion unavailable", error);
      set((state) => ({ suggestions: { ...state.suggestions, [key]: null } }));
      return null;
    }
  },

  dismissSuggestion: async (suggestion) => {
    await languageProfilesApi.dismissLanguageProfileSuggestion(
      suggestion.profile.id,
      suggestion.contentType,
      suggestion.contentId,
      suggestion.evidence,
      get().scope,
    );
    set((state) => ({ suggestions: { ...state.suggestions, [suggestionKey(suggestion.contentType, suggestion.contentId)]: null } }));
    get().invalidateProfileProjections();
  },

  invalidateProfileProjections: () => set((state) => ({ projectionEpoch: state.projectionEpoch + 1 })),
}));
