import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguagePracticeOverlay } from "../LanguagePracticeOverlay";
import { LanguageReaderHostPanel } from "../LanguageReaderHostPanel";
import { LanguageVideoHost } from "../LanguageVideoHost";
import { LANGUAGE_HOST_ACTION_EVENT } from "../../../lib/languageHost";

const mocks = vi.hoisted(() => ({
  snapshot: {
    hostId: "host-1",
    surface: "reader" as const,
    status: "ready" as const,
    source: { source: { sourceType: "text", documentId: "doc-1", sourceId: "doc-1" }, contentType: "document" as const, contentId: "doc-1", contentFingerprint: "fp-1", text: "Hola mundo" },
    profileContext: null,
    profile: { id: "profile-1", accountId: "local", workspaceId: "default", name: "Spanish", targetLanguage: "es", baseLanguage: "en", preferences: { highlightDensity: "balanced", showTranslation: true, showExplanation: true, translationProvider: "local", explanationProvider: "local" }, processingConfig: { provider: "local", offlineCapable: true, dictionaryEnabled: true, ttsEnabled: true, transcriptionEnabled: true }, createdAt: "2026-01-01", updatedAt: "2026-01-01", lifecycle: "active" as const, version: 1 },
    capabilities: Object.fromEntries(["analysis", "annotations", "peek", "translation", "readingAssist", "sentenceMode", "originalAudio", "tutor", "practice", "mining", "frameCapture"].map((name) => [name, { name, available: true, offline: true }])) as Record<string, { name: string; available: boolean; offline: boolean }>,
    epoch: 1,
  },
}));

vi.mock("../../../contexts/LanguageLearningHostContext", () => ({
  useLanguageLearningHost: () => ({ snapshot: mocks.snapshot, refresh: vi.fn(), controller: {} }),
  useOptionalLanguageLearningHost: () => ({ snapshot: mocks.snapshot, refresh: vi.fn(), controller: {} }),
}));
vi.mock("../../viewer/selectionInteraction/DictionaryPeek", () => ({ DictionaryPeek: () => null }));
vi.mock("../../../api/languageLexicon", () => ({ listLanguageLexicalEntries: vi.fn(async () => ({ items: [], offset: 0, limit: 500, total: 0, hasMore: false })) }));
vi.mock("../../../hooks/useTTS", () => ({ useTTS: () => ({ speak: vi.fn(async () => undefined) }) }));
vi.mock("../../../lib/languageTranslation", () => ({ createTranslationService: () => ({ translate: vi.fn(async () => { throw new Error("offline"); }) }) }));
vi.mock("../../../lib/tauri", () => ({ isTauri: () => false, isNativeMobile: () => false, invokeCommand: vi.fn() }));

const sourceAnchor = { sourceType: "text", documentId: "doc-1", sourceId: "doc-1", contentFingerprint: "fp-1", locator: { start: 0, end: 4 } };
const source = mocks.snapshot.source;

describe("language host surface integrations", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("keeps reader actions keyboard reachable and source-grounded", () => {
    const onModeChange = vi.fn();
    const action = vi.fn();
    window.addEventListener(LANGUAGE_HOST_ACTION_EVENT, action);
    render(<LanguageReaderHostPanel documentId="doc-1" selectedText="Hola" sourceAnchor={sourceAnchor} languageModeEnabled onLanguageModeChange={onModeChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Practice Hola" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Sentence Mode" }));

    expect(action).toHaveBeenCalledTimes(2);
    expect(action.mock.calls[0]?.[0]).toMatchObject({ detail: { action: "practice", origin: "reader", sourceAnchor } });
    expect(screen.getByRole("button", { name: "Practice Hola" })).not.toBeDisabled();
    window.removeEventListener(LANGUAGE_HOST_ACTION_EVENT, action);
  });

  it("layers video language actions on the player clock and keeps mining provenance", async () => {
    const mining = vi.fn();
    window.addEventListener("plethora-language-mining-draft", mining);
    render(<LanguageVideoHost videoId="video-1" documentId="doc-1" sourceFingerprint="media-fp" currentTime={1} segments={[{ id: "seg-1", start: 0, end: 2, text: "Hola mundo" }]} onSeek={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("button", { name: /Mine/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Mine/ }));
    expect(mining).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.objectContaining({ sourceType: "video", mediaId: "video-1", mediaStartMs: 0, mediaEndMs: 2000, sourceFingerprint: "media-fp" }) }));
    window.removeEventListener("plethora-language-mining-draft", mining);
  });

  it("requires explicit dictation reveal/evidence decisions and preserves raw answers", async () => {
    const evidence = vi.fn();
    window.addEventListener("plethora-language-srs-draft", evidence);
    render(<LanguagePracticeOverlay />);
    act(() => {
      window.dispatchEvent(new CustomEvent(LANGUAGE_HOST_ACTION_EVENT, { detail: { action: "practice", hostId: "host-1", source, sourceAnchor, selectedText: "Hola mundo", profileId: "profile-1", languageTag: "es", origin: "reader" } }));
    });

    expect(await screen.findByRole("dialog", { name: "Language practice" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    const response = screen.getByRole("textbox", { name: "Practice response" });
    fireEvent.change(response, { target: { value: "Hola mundo" } });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByText("Exact match")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Accept as active evidence/ }));
    expect(evidence).not.toHaveBeenCalled();
    window.removeEventListener("plethora-language-srs-draft", evidence);
  });
});
