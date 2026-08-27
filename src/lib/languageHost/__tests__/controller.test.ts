import { describe, expect, it, vi } from "vitest";
import { LanguageLearningHostController } from "../controller";
import type { LanguageHostResolutionInput } from "../types";

const profileContext = {
  profile: {
    id: "profile-es",
    accountId: "local",
    workspaceId: "default",
    name: "Spanish",
    targetLanguage: "es",
    baseLanguage: "en",
    preferences: { highlightDensity: "balanced", showTranslation: true, showExplanation: true, translationProvider: "local", explanationProvider: "local" },
    processingConfig: { provider: "local", offlineCapable: true, dictionaryEnabled: true, ttsEnabled: true, transcriptionEnabled: true },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lifecycle: "active" as const,
    version: 1,
  },
  association: {
    id: "association-1",
    accountId: "local",
    workspaceId: "default",
    profileId: "profile-es",
    contentType: "document" as const,
    contentId: "doc-1",
    mode: "enabled" as const,
    suggestionDismissed: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
  },
  source: "confirmed_association",
  contextVersion: 1,
};

function input(overrides: Partial<LanguageHostResolutionInput> = {}): LanguageHostResolutionInput {
  return {
    hostId: "reader-1",
    surface: "reader",
    source: {
      contentType: "document",
      contentId: "doc-1",
      contentFingerprint: "v1",
      source: { sourceType: "text", documentId: "doc-1", contentFingerprint: "v1" },
    },
    languageModeEnabled: true,
    resolveProfile: async () => profileContext,
    ...overrides,
  };
}

describe("LanguageLearningHostController", () => {
  it("returns disabled with no provider work when Language Mode is off", async () => {
    const resolveProfile = vi.fn(async () => profileContext);
    const snapshot = await new LanguageLearningHostController().resolve(input({ languageModeEnabled: false, resolveProfile }));
    expect(snapshot.status).toBe("disabled");
    expect(snapshot.capabilities.peek.available).toBe(false);
    expect(resolveProfile).not.toHaveBeenCalled();
  });

  it("resolves a ready profile-scoped host with explicit capabilities", async () => {
    const snapshot = await new LanguageLearningHostController().resolve(input({
      capabilities: {
        practice: { name: "practice", available: true, offline: true },
      },
    }));
    expect(snapshot.status).toBe("ready");
    expect(snapshot.profile?.targetLanguage).toBe("es");
    expect(snapshot.capabilities.practice.available).toBe(true);
    expect(snapshot.capabilities.translation.available).toBe(false);
  });

  it("rejects a late resolution after invalidation", async () => {
    let release: (() => void) | undefined;
    const resolveProfile = () => new Promise<typeof profileContext>((resolve) => { release = () => resolve(profileContext); });
    const controller = new LanguageLearningHostController();
    const pending = controller.resolve(input({ resolveProfile }));
    controller.invalidate();
    release?.();
    const snapshot = await pending;
    expect(snapshot.status).toBe("cancelled");
  });

  it("marks provider failures as unavailable capabilities without throwing", async () => {
    const snapshot = await new LanguageLearningHostController().resolve(input({ resolveProfile: async () => { throw new Error("offline"); } }));
    expect(snapshot.status).toBe("failed");
    expect(snapshot.error?.message).toBe("offline");
    expect(snapshot.capabilities.translation.reason).toBe("provider-failed");
  });

  it("does not consider a snapshot current after its source fingerprint changes", async () => {
    const controller = new LanguageLearningHostController();
    const snapshot = await controller.resolve(input());
    expect(controller.isCurrent(snapshot)).toBe(true);
    expect(controller.isCurrent({ ...snapshot, source: { ...snapshot.source, contentFingerprint: "v2" } })).toBe(false);
  });
});

