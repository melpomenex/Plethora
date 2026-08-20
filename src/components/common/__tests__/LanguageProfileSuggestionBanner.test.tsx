import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProfileSuggestionBanner } from "../LanguageProfileSuggestionBanner";
import { useLanguageProfileStore } from "../../../stores/languageProfileStore";

const suggestion = {
  profile: {
    id: "profile-es",
    accountId: "local",
    workspaceId: "default",
    name: "Spanish",
    targetLanguage: "es",
    baseLanguage: "en",
    preferences: { highlightDensity: "balanced", showTranslation: true, showExplanation: true, translationProvider: "local", explanationProvider: "local" },
    processingConfig: { provider: "local", offlineCapable: true, dictionaryEnabled: true, ttsEnabled: true, transcriptionEnabled: true },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    lifecycle: "active" as const,
    version: 1,
  },
  contentType: "document" as const,
  contentId: "doc-1",
  evidence: { language: "es", confidence: 0.98 },
};

afterEach(() => {
  useLanguageProfileStore.setState({ suggestions: {}, loaded: false, loading: false, error: null });
});

describe("LanguageProfileSuggestionBanner", () => {
  it("offers explicit enable, dismiss, and disable actions without card creation", async () => {
    const associateContent = vi.fn().mockResolvedValue(undefined);
    const dismissSuggestion = vi.fn().mockResolvedValue(undefined);
    const loadSuggestion = vi.fn().mockResolvedValue(suggestion);
    useLanguageProfileStore.setState({
      suggestions: { "document:doc-1": suggestion },
      associateContent,
      dismissSuggestion,
      loadSuggestion,
    });

    render(<LanguageProfileSuggestionBanner contentType="document" contentId="doc-1" evidence={{ language: "es" }} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /study as spanish/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /not now/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /disable/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /study as spanish/i }));
    await waitFor(() => expect(associateContent).toHaveBeenCalledWith(expect.objectContaining({ mode: "enabled", contentId: "doc-1" })));
    expect(dismissSuggestion).not.toHaveBeenCalled();
  });
});
