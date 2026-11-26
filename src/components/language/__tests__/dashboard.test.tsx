import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TabContent } from "../../common/Tabs/TabContent";
import { VocabularyManagerView } from "../dashboard/VocabularyManagerView";
import { useLanguageProfileStore } from "../../../stores/languageProfileStore";
import type { Tab } from "../../../stores/tabsStore";

const searchMock = vi.fn();
const listMock = vi.fn();
const setBatchMock = vi.fn();
const surfacesMock = vi.fn();
const occurrencesMock = vi.fn();

vi.mock("../../../api/languageLexicon", () => ({
  searchLanguageLexicalEntries: (...args: unknown[]) => searchMock(...args),
  listLanguageLexicalEntries: (...args: unknown[]) => listMock(...args),
  listLanguageSurfaceForms: (...args: unknown[]) => surfacesMock(...args),
  listLanguageOccurrences: (...args: unknown[]) => occurrencesMock(...args),
  deleteLanguageLexicalEntry: vi.fn(),
  exportLanguageLexicon: vi.fn(),
}));

vi.mock("../../../api/languageKnowledge", () => ({
  setLanguageKnowledgeStatesBatch: (...args: unknown[]) => setBatchMock(...args),
  importLanguageKnownWords: vi.fn(),
  previewLanguageKnownWordImport: vi.fn(),
}));

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({ t: (k: string) => k }),
}));

describe("VocabularyManagerView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLanguageProfileStore.setState({
      activeProfile: {
        id: "prof-1",
        targetLanguage: "es",
        baseLanguage: "en",
        proficiency: "A2",
      } as never,
    });
    const samplePage = {
      items: [
        {
          id: "lex-1",
          profileId: "prof-1",
          languageTag: "es",
          objectKind: "token",
          lexicalKey: "hablar",
          normalizedForm: "hablo",
          canonicalForm: "hablo",
          lemma: "hablar",
          meanings: ["to speak"],
          translations: [],
          partOfSpeech: "verb",
          encounterCount: 4,
          documentCount: 1,
          lookupCount: 1,
          activeEvidenceCount: 0,
          passiveEvidenceCount: 0,
          knowledgeState: "ignored",
          reviewRelationships: { "card-1": {} },
          ignored: true,
          properNoun: false,
          createdAt: 1,
          updatedAt: 1,
          version: 1,
        },
      ],
      total: 1,
      offset: 0,
      limit: 50,
      hasMore: false,
    };
    listMock.mockResolvedValue(samplePage);
    searchMock.mockResolvedValue(samplePage);
    surfacesMock.mockResolvedValue({ items: [{ id: "sf-1", surface: "hablo", occurrenceCount: 4 }] });
    occurrencesMock.mockResolvedValue({
      items: [{ id: "occ-1", documentId: "doc-9", surface: "hablo", contextText: "Yo hablo español." }],
    });
    setBatchMock.mockResolvedValue(undefined);
  });

  it("queries searchLanguageLexicalEntries with knowledgeState when state filter is selected", async () => {
    render(<VocabularyManagerView />);
    await waitFor(() => expect(listMock).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "languageLearning.knowledgeState.ignored" }));
    await waitFor(() => {
      expect(searchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          profileId: "prof-1",
          knowledgeState: "ignored",
        }),
      );
    });
  });

  it("supports restoring ignored entries and expanding surface forms and occurrences", async () => {
    render(<VocabularyManagerView />);
    await waitFor(() => expect(screen.getByText("hablo")).toBeTruthy());

    fireEvent.click(screen.getByText("Restore"));
    await waitFor(() => {
      expect(setBatchMock).toHaveBeenCalledWith([{ profileId: "prof-1", entryId: "lex-1", state: "learning" }]);
    });

    fireEvent.click(screen.getByText("hablo"));
    await waitFor(() => {
      expect(screen.getByText(/Yo hablo español\./)).toBeTruthy();
      expect(screen.getByText(/hablo \(4\)/)).toBeTruthy();
    });
  });

  it("hides the import dialog on an inactive tab and preserves the draft", async () => {
    const tabs: Tab[] = [
      { id: "language", title: "Language Learning", icon: null, type: "language-learning", content: VocabularyManagerView, closable: true },
      { id: "other", title: "Other", icon: null, type: "dashboard", content: () => null, closable: true },
    ];
    const { rerender } = render(<TabContent tabs={tabs} activeTabId="language" />);
    await screen.findByText("hablo");

    fireEvent.click(screen.getByRole("button", { name: "languageLearning.vocabulary.import" }));
    fireEvent.change(screen.getByRole("textbox", { name: "languageLearning.vocabulary.importTitle" }), {
      target: { value: "hola" },
    });
    rerender(<TabContent tabs={tabs} activeTabId="other" />);
    expect(screen.queryByRole("dialog")).toBeNull();

    rerender(<TabContent tabs={tabs} activeTabId="language" />);
    expect(screen.getByRole("textbox", { name: "languageLearning.vocabulary.importTitle" })).toHaveValue("hola");
  });
});
