import { describe, expect, it, beforeEach, vi } from "vitest";
import { LanguageLearningHostController } from "../controller";
import { resolveLanguageHostCapabilities } from "../capabilities";
import { useLanguageProfileStore } from "../../../stores/languageProfileStore";
import * as languageProfilesApi from "../../../api/languageProfiles";
import { SPANISH_PRACTICE_FIXTURE } from "../testing";

vi.mock("../../../api/languageProfiles", () => ({
  createLanguageProfile: vi.fn(),
  getLanguageProfiles: vi.fn(),
  getActiveLanguageProfile: vi.fn(),
  setActiveLanguageProfile: vi.fn(),
  associateLanguageProfileContent: vi.fn(),
  resolveLanguageProfileContext: vi.fn(),
  getLanguageProfileSuggestion: vi.fn(),
  dismissLanguageProfileSuggestion: vi.fn(),
}));

const profile = {
  id: SPANISH_PRACTICE_FIXTURE.profileId,
  accountId: "local",
  workspaceId: "default",
  name: "Spanish",
  targetLanguage: "es",
  baseLanguage: "en",
  proficiency: "A2",
  preferences: { highlightDensity: "balanced", showTranslation: true, showExplanation: true, translationProvider: "local", explanationProvider: "local" },
  processingConfig: { provider: "local", offlineCapable: true, dictionaryEnabled: true, ttsEnabled: true, transcriptionEnabled: true },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lifecycle: "active" as const,
  version: 1,
};

const association = {
  id: "association-es-doc",
  accountId: "local",
  workspaceId: "default",
  profileId: profile.id,
  contentType: "document" as const,
  contentId: "fixture-spanish-doc",
  mode: "enabled" as const,
  suggestionDismissed: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  version: 1,
};

describe("language mode golden path", () => {
  beforeEach(() => {
    vi.mocked(languageProfilesApi.getLanguageProfiles).mockResolvedValue([profile]);
    vi.mocked(languageProfilesApi.getActiveLanguageProfile).mockResolvedValue(profile);
    vi.mocked(languageProfilesApi.associateLanguageProfileContent).mockResolvedValue(association);
    vi.mocked(languageProfilesApi.resolveLanguageProfileContext)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        profile,
        association,
        source: "confirmed_association",
        contextVersion: 1,
      });
  });

  it("creates association then resolves a ready host with truthful capabilities", async () => {
    await useLanguageProfileStore.getState().load();
    await useLanguageProfileStore.getState().setActiveProfile(profile.id);

    const unresolved = await useLanguageProfileStore.getState().resolveContext("document", "fixture-spanish-doc");
    expect(unresolved).toBeNull();

    await useLanguageProfileStore.getState().associateContent({
      profileId: profile.id,
      contentType: "document",
      contentId: "fixture-spanish-doc",
      mode: "enabled",
      detectionEvidence: { language: "es" },
    });
    expect(languageProfilesApi.associateLanguageProfileContent).toHaveBeenCalled();

    const resolved = await useLanguageProfileStore.getState().resolveContext("document", "fixture-spanish-doc");
    expect(resolved?.profile.id).toBe(profile.id);

    const controller = new LanguageLearningHostController();
    const snapshot = await controller.resolve({
      hostId: "golden-path",
      surface: "reader",
      source: {
        contentType: "document",
        contentId: "fixture-spanish-doc",
        contentFingerprint: "fixture-spanish-doc-v1",
        source: { sourceType: "text", documentId: "fixture-spanish-doc", contentFingerprint: "fixture-spanish-doc-v1" },
      },
      languageModeEnabled: true,
      resolveProfile: () => useLanguageProfileStore.getState().resolveContext("document", "fixture-spanish-doc"),
      capabilities: resolveLanguageHostCapabilities({ surface: "reader", profile }),
    });

    expect(snapshot.status).toBe("ready");
    expect(snapshot.capabilities.peek.available).toBe(true);
    expect(snapshot.capabilities.practice.available).toBe(true);
    expect(snapshot.capabilities.practice.detail).toContain("dictation");
    expect(snapshot.capabilities.frameCapture.available).toBe(false);
  });
});
