import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";

const mocks = vi.hoisted(() => ({
  useTTS: vi.fn((_opts?: { lang?: string }) => ({
    speak: vi.fn(async () => undefined),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    isSpeaking: false,
    isPaused: false,
    isGenerating: false,
    lastError: null,
    isSupported: true,
    voices: [],
    selectedVoice: null,
    setSelectedVoice: vi.fn(),
  })),
  lookup: vi.fn(),
  resolveSurface: vi.fn(async () => null as unknown),
  setKnowledgeState: vi.fn(async (input: { profileId: string; entryId: string; state: string }) => ({
    profileId: input.profileId,
    lexicalEntryId: input.entryId,
    state: input.state,
    manualOverride: true,
    passiveEvidence: 0,
    activeEvidence: 0,
    updatedAt: 1,
    version: 1,
  })),
  upsertLanguageLexicalEntry: vi.fn(async (input: { profileId: string; normalizedForm: string }) => ({
    id: "created-entry-1",
    profileId: input.profileId,
    languageTag: "es",
    objectKind: "token",
    lexicalKey: `es:${input.normalizedForm}`,
    normalizedForm: input.normalizedForm,
    canonicalForm: input.normalizedForm,
    meanings: [],
    translations: [],
    encounterCount: 0,
    documentCount: 0,
    lookupCount: 0,
    activeEvidenceCount: 0,
    passiveEvidenceCount: 0,
    reviewRelationships: {},
    ignored: false,
    properNoun: false,
    createdAt: 1,
    updatedAt: 1,
    version: 1,
  })),
  listLanguageOccurrences: vi.fn(async () => ({ items: [], offset: 0, limit: 1, total: 4, hasMore: false })),
  recordLanguageLookup: vi.fn(async () => ({})),
  memorizeLanguageDraft: vi.fn(async () => ({ item: { id: "item-1" } })),
}));

vi.mock("../../../../hooks/useTTS", () => ({
  useTTS: mocks.useTTS,
}));

vi.mock("../../../../lib/languagePeek", async () => {
  const actual = await vi.importActual<typeof import("../../../../lib/languagePeek")>("../../../../lib/languagePeek");
  return {
    ...actual,
    languagePeekService: {
      lookup: mocks.lookup,
      clear: vi.fn(),
    },
  };
});

vi.mock("../../../../api/languageLexicon", () => ({
  upsertLanguageLexicalEntry: mocks.upsertLanguageLexicalEntry,
  listLanguageOccurrences: mocks.listLanguageOccurrences,
  recordLanguageLookup: mocks.recordLanguageLookup,
}));

vi.mock("../../../../api/languageSrs", () => ({
  memorizeLanguageDraft: mocks.memorizeLanguageDraft,
}));

vi.mock("../../../../api/undoable", () => ({
  useUndoableOperations: () => ({ deleteLearningItem: vi.fn(async () => undefined) }),
}));

vi.mock("../../../common/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock("../../../../lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params?.word ? `${key}:${String(params.word)}` : key,
  }),
}));

vi.mock("../../../../contexts/PresentationContext", () => ({
  usePresentation: () => ({ reducedMotion: true, pointer: "fine", isMobileShell: false }),
  useIsEink: () => false,
}));

vi.mock("../../../../hooks/useOverlayDismissal", () => ({
  useOverlayDismissal: vi.fn(),
}));

vi.mock("../../../../hooks/useHapticFeedback", () => ({
  useHapticFeedback: () => ({ click: vi.fn() }),
}));

vi.mock("../SelectionPopup", () => ({
  copySelectionTextToClipboard: vi.fn(async () => true),
}));

import { DictionaryPeek, type DictionaryPeekTarget } from "../DictionaryPeek";
import { useLanguageProfileStore } from "../../../../stores/languageProfileStore";
import { useLanguageKnowledgeStore } from "../../../../stores/languageKnowledgeStore";

function renderPeek(target: DictionaryPeekTarget) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DictionaryPeek
        target={target}
        documentId="doc-es-1"
        onDismiss={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe("DictionaryPeek multilingual behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLanguageProfileStore.setState({
      activeProfileId: "global-profile",
      profiles: [
        {
          id: "doc-profile",
          name: "Spanish",
          targetLanguage: "es",
          baseLanguage: "en",
          scope: { accountId: "local", workspaceId: "default" },
          archived: false,
          createdAt: 1,
          updatedAt: 1,
        } as never,
      ],
    });
    useLanguageKnowledgeStore.setState({
      resolveSurface: mocks.resolveSurface as never,
      setState: mocks.setKnowledgeState as never,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("passes target.languageTag to useTTS, prefers target.profileId over activeProfileId, and sets dir='rtl' for RTL tags", async () => {
    mocks.lookup.mockResolvedValue({
      ok: true,
      result: {
        providerId: "wiktionary-rest",
        providerVersion: "v1",
        provenance: "dedicated",
        dictionary: {
          word: "كتاب",
          senses: [{ partOfSpeech: "noun", definition: "book" }],
          synonyms: [],
        },
      },
    });
    mocks.resolveSurface.mockResolvedValue({
      profileId: "doc-profile",
      lexicalEntryId: "entry-kitab",
      state: "learning",
      manualOverride: false,
      passiveEvidence: 1,
      activeEvidence: 0,
      updatedAt: 1,
      version: 1,
    });

    renderPeek({
      text: "كتاب",
      profileId: "doc-profile",
      languageTag: "ar-EG",
      geometry: null,
    });

    expect(mocks.useTTS).toHaveBeenCalledWith({ lang: "ar-EG" });

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("dir", "rtl");

    await waitFor(() => {
      expect(mocks.lookup).toHaveBeenCalledWith(
        "كتاب",
        expect.objectContaining({ profileId: "doc-profile", languageTag: "ar-EG" }),
      );
      expect(mocks.resolveSurface).toHaveBeenCalledWith("doc-profile", "كتاب");
      expect(mocks.recordLanguageLookup).toHaveBeenCalledWith(
        expect.objectContaining({ profileId: "doc-profile", languageTag: "ar-EG" }),
      );
    });

    expect(screen.getByTestId("language-peek-provenance")).toHaveTextContent("Online · Wiktionary");
    expect(await screen.findByTestId("language-peek-encounters")).toHaveTextContent("Previous encounters: 4");
  });

  it("always renders LanguageKnowledgeStateSelector and language context when lookup fails offline, and upserts lexical entry on state change", async () => {
    mocks.lookup.mockResolvedValue({
      ok: false,
      failure: { kind: "offline-uncached" },
    });
    mocks.resolveSurface.mockResolvedValue(null);

    renderPeek({
      text: "食べる",
      profileId: "doc-profile",
      languageTag: "ja",
      analysis: {
        lemma: "食べる",
        partOfSpeech: "v1",
        reading: "たべる",
        transliteration: "taberu",
        morphology: { class: "ichidan" },
      },
      phrase: { normalizedForm: "ご飯を食べる", translation: "to eat a meal" },
      sentence: { text: "朝ご飯を食べる。", translation: "I eat breakfast." },
      geometry: null,
    });

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("dir", "ltr");
    expect(await screen.findByText("viewer.dictionaryPeek.offline")).toBeInTheDocument();

    const context = screen.getByTestId("language-peek-context");
    expect(context).toHaveTextContent("Lemma: 食べる");
    expect(context).toHaveTextContent("Part of speech: v1");
    expect(context).toHaveTextContent("Reading: たべる");
    expect(context).toHaveTextContent("Transliteration: taberu");
    expect(context).toHaveTextContent("to eat a meal");
    expect(context).toHaveTextContent("朝ご飯を食べる。");

    const selector = screen.getByLabelText("Language knowledge state") as HTMLSelectElement;
    expect(selector.value).toBe("new");

    fireEvent.change(selector, { target: { value: "learning" } });

    await waitFor(() => {
      expect(mocks.upsertLanguageLexicalEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          profileId: "doc-profile",
          languageTag: "ja",
          canonicalForm: "食べる",
          lemma: "食べる",
          partOfSpeech: "v1",
        }),
      );
      expect(mocks.setKnowledgeState).toHaveBeenCalledWith({
        profileId: "doc-profile",
        entryId: "created-entry-1",
        state: "learning",
      });
    });
  });

  it("shows AI definition provenance badge and dispatches plethora-language-mining-draft from Mine sentence", async () => {
    mocks.lookup.mockResolvedValue({
      ok: true,
      result: {
        providerId: "plethora-ai-dict",
        providerVersion: "1.0.0",
        provenance: "ai",
        dictionary: {
          word: "madrugada",
          senses: [{ partOfSpeech: "noun", definition: "dawn" }],
          synonyms: [],
        },
      },
    });
    mocks.resolveSurface.mockResolvedValue(null);

    const miningEvents: CustomEvent[] = [];
    const listener = (event: Event) => miningEvents.push(event as CustomEvent);
    window.addEventListener("plethora-language-mining-draft", listener);

    renderPeek({
      text: "madrugada",
      profileId: "doc-profile",
      languageTag: "es",
      sentence: { text: "Salió de madrugada.", translation: "She left at dawn." },
      sourceAnchor: { sourceType: "epub", documentId: "doc-es-1", locator: { cfi: "epubcfi(/6/2)" } },
      geometry: null,
    });

    expect(await screen.findByTestId("language-peek-provenance")).toHaveTextContent("AI definition");

    const mineButton = screen.getByRole("button", { name: "Mine sentence" });
    fireEvent.click(mineButton);

    expect(miningEvents).toHaveLength(1);
    expect(miningEvents[0]!.detail).toMatchObject({
      payloadVersion: 1,
      profileId: "doc-profile",
      sourceType: "epub",
      documentId: "doc-es-1",
      text: "madrugada",
      sentenceText: "Salió de madrugada.",
      origin: "mining",
    });

    window.removeEventListener("plethora-language-mining-draft", listener);
  });
});
