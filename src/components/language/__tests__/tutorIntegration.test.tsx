import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageTutorHost } from "../LanguageTutorHost";
import { LANGUAGE_HOST_ACTION_EVENT } from "../../../lib/languageHost";

const aiMocks = vi.hoisted(() => ({
  path: "ondevice" as "none" | "ondevice" | "cloud",
  respond: vi.fn(),
}));

vi.mock("../../../lib/ai/useAiAvailability", () => ({
  useAiAvailability: () => ({ path: aiMocks.path, ready: aiMocks.path !== "none" }),
}));

vi.mock("../../../lib/languageTutor/aiProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/languageTutor/aiProvider")>();
  return {
    ...actual,
    createProductionLanguageTutorService: () => ({
      supports: () => true,
      respond: (...args: unknown[]) => aiMocks.respond(...args),
    }),
  };
});

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

  it("passes familiarity target and correction level, and supports Stop during in-flight generation", async () => {
    aiMocks.path = "ondevice";
    aiMocks.respond.mockImplementation(
      ({ signal }: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("cancelled")));
        }),
    );
    render(<LanguageTutorHost />);
    act(() => window.dispatchEvent(new CustomEvent(LANGUAGE_HOST_ACTION_EVENT, { detail: { action: "tutor", hostId: "host-tutor", source: mocks.snapshot.source, sourceAnchor: { sourceType: "text", documentId: "doc-1", sourceId: "doc-1", contentFingerprint: "fp-current" }, selectedText: "Hola mundo", profileId: "profile-1", languageTag: "es", origin: "reader" } })));

    await waitFor(() => expect(screen.getByLabelText("Target lexical familiarity")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Target lexical familiarity"), { target: { value: "90" } });
    fireEvent.change(screen.getByLabelText("Correction granularity"), { target: { value: "detailed" } });
    fireEvent.click(screen.getByRole("button", { name: "Quick ask" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument());
    expect(aiMocks.respond).toHaveBeenCalledWith(
      expect.objectContaining({ targetLexicalCoveragePercent: 90, correctionLevel: "detailed" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Stop" })).toBeNull());
  });

  it("disables Quick ask when no AI provider is available", async () => {
    aiMocks.path = "none";
    render(<LanguageTutorHost />);
    act(() => window.dispatchEvent(new CustomEvent(LANGUAGE_HOST_ACTION_EVENT, { detail: { action: "tutor", hostId: "host-tutor", source: mocks.snapshot.source, sourceAnchor: { sourceType: "text", documentId: "doc-1", sourceId: "doc-1", contentFingerprint: "fp-current" }, selectedText: "Hola mundo", profileId: "profile-1", languageTag: "es", origin: "reader" } })));
    await waitFor(() => expect(screen.getByRole("button", { name: "Quick ask" })).toBeDisabled());
    aiMocks.path = "ondevice";
  });
});
