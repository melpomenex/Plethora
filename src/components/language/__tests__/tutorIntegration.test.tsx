import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageTutorHost } from "../LanguageTutorHost";
import { LANGUAGE_HOST_ACTION_EVENT } from "../../../lib/languageHost";

const mocks = vi.hoisted(() => ({
  snapshot: {
    hostId: "host-tutor",
    surface: "reader" as const,
    status: "ready" as const,
    source: { source: { sourceType: "text", documentId: "doc-1", sourceId: "doc-1" }, contentType: "document" as const, contentId: "doc-1", contentFingerprint: "fp-current", text: "Hola mundo" },
    profileContext: null,
    profile: { id: "profile-1", accountId: "local", workspaceId: "default", name: "Spanish", targetLanguage: "es", baseLanguage: "en", preferences: { highlightDensity: "balanced", showTranslation: true, showExplanation: true, translationProvider: "local", explanationProvider: "local" }, processingConfig: { provider: "local", offlineCapable: true, dictionaryEnabled: true, ttsEnabled: true, transcriptionEnabled: true }, createdAt: "2026-01-01", updatedAt: "2026-01-01", lifecycle: "active" as const, version: 1 },
    capabilities: {} as Record<string, { name: string; available: boolean; offline: boolean }>,
    epoch: 1,
  },
}));

vi.mock("../../../contexts/LanguageLearningHostContext", () => ({ useLanguageLearningHost: () => ({ snapshot: mocks.snapshot, refresh: vi.fn(), controller: {} }) }));
vi.mock("../../../api/languageLexicon", () => ({ listLanguageLexicalEntries: vi.fn(async () => ({ items: [{ id: "entry-1", canonicalForm: "viajar", normalizedForm: "viajar", lemma: "viajar", knowledgeState: "learning", activeEvidenceCount: 2, passiveEvidenceCount: 1 }], offset: 0, limit: 500, total: 1, hasMore: false })) }));
vi.mock("../../tutor/TutorSheet", () => ({
  TutorSheet: (props: { languageContext?: { freshness: string }; onWritingPractice?: (text: string) => void }) => <div data-testid="tutor-sheet" data-freshness={props.languageContext?.freshness ?? "missing"}><button type="button" onClick={() => props.onWritingPractice?.("Write about Hola mundo")}>Start writing practice</button></div>,
}));

describe("language tutor host integration", () => {
  afterEach(() => {
    vi.clearAllMocks();
    window.dispatchEvent(new CustomEvent(LANGUAGE_HOST_ACTION_EVENT, { detail: null }));
    mocks.snapshot.source.contentFingerprint = "fp-current";
  });

  it("builds bounded context and routes writing practice with source provenance", async () => {
    const action = vi.fn();
    window.addEventListener(LANGUAGE_HOST_ACTION_EVENT, action);
    render(<LanguageTutorHost />);
    act(() => window.dispatchEvent(new CustomEvent(LANGUAGE_HOST_ACTION_EVENT, { detail: { action: "tutor", hostId: "host-tutor", source: mocks.snapshot.source, sourceAnchor: { sourceType: "text", documentId: "doc-1", sourceId: "doc-1", contentFingerprint: "fp-current" }, selectedText: "Hola mundo", profileId: "profile-1", languageTag: "es", origin: "reader" } })));

    await waitFor(() => expect(screen.getByTestId("tutor-sheet")).toHaveAttribute("data-freshness", "fresh"));
    fireEvent.click(screen.getByRole("button", { name: "Start writing practice" }));
    expect(action).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.objectContaining({ action: "practice", practiceMode: "writing", origin: "tutor", sourceAnchor: expect.objectContaining({ sourceId: "doc-1" }) }) }));
    window.removeEventListener(LANGUAGE_HOST_ACTION_EVENT, action);
  });

  it("blocks a request whose source fingerprint is stale", async () => {
    render(<LanguageTutorHost />);
    act(() => window.dispatchEvent(new CustomEvent(LANGUAGE_HOST_ACTION_EVENT, { detail: { action: "tutor", hostId: "host-tutor", source: { ...mocks.snapshot.source, contentFingerprint: "fp-old" }, sourceAnchor: { sourceType: "text", documentId: "doc-1", sourceId: "doc-1", contentFingerprint: "fp-old" }, selectedText: "Hola", profileId: "profile-1", languageTag: "es", origin: "reader" } })));
    expect(await screen.findByText("Tutor source changed")).toBeInTheDocument();
    expect(screen.queryByTestId("tutor-sheet")).toBeNull();
  });
});
