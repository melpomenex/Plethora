import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hostMocks = vi.hoisted(() => ({
  targetLanguage: "ja",
  text: "日本語を読む",
  knownItems: [] as Array<{
    id: string;
    normalizedForm: string;
    canonicalForm: string;
    lemma?: string;
    knowledgeState?: string;
  }>,
  aiAvailable: false,
}));

vi.mock("../../../contexts/LanguageLearningHostContext", () => ({
  useLanguageLearningHost: () => ({
    snapshot: {
      hostId: "host-ra",
      surface: "reader",
      status: "ready",
      source: {
        source: { sourceType: "text", documentId: "doc-1", sourceId: "doc-1" },
        contentType: "document",
        contentId: "doc-1",
        contentFingerprint: "fp-1",
        text: hostMocks.text,
      },
      profileContext: null,
      profile: {
        id: "profile-1",
        accountId: "local",
        workspaceId: "default",
        name: "Learner",
        targetLanguage: hostMocks.targetLanguage,
        baseLanguage: "en",
        preferences: {
          highlightDensity: "balanced",
          showTranslation: true,
          showExplanation: true,
          translationProvider: "local",
          explanationProvider: "local",
        },
        processingConfig: {
          provider: "local",
          offlineCapable: true,
          dictionaryEnabled: true,
          ttsEnabled: true,
          transcriptionEnabled: true,
        },
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
        lifecycle: "active",
        version: 1,
      },
      capabilities: {
        readingAssist: { name: "readingAssist", available: true, offline: true },
      },
      epoch: 1,
    },
    readingAssistRegistry: undefined,
  }),
}));

vi.mock("../../../api/languageLexicon", () => ({
  listLanguageLexicalEntries: vi.fn(async () => ({
    items: hostMocks.knownItems,
    offset: 0,
    limit: 500,
    total: hostMocks.knownItems.length,
    hasMore: false,
  })),
}));

vi.mock("../../ai/provider", () => ({
  hasCloudProvider: () => hostMocks.aiAvailable,
  isAnyAiAvailable: async () => hostMocks.aiAvailable,
  resolveAiPath: async () => (hostMocks.aiAvailable ? "cloud" : "none"),
}));

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    locale: "en",
    t: (_key: string, fallbackOrVars?: string | Record<string, unknown>, vars?: Record<string, unknown>) => {
      const template = typeof fallbackOrVars === "string" ? fallbackOrVars : _key;
      const replacements = typeof fallbackOrVars === "object" ? fallbackOrVars : vars;
      if (!replacements) return template;
      return template.replace(/\{(\w+)\}/g, (_, k: string) => String(replacements[k] ?? `{${k}}`));
    },
  }),
}));

import { LanguageReadingAssistOverlay } from "../../../components/language/LanguageReadingAssistOverlay";
import { LANGUAGE_HOST_ACTION_EVENT } from "../../languageHost";

function dispatchOpen(text: string, languageTag: string) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent(LANGUAGE_HOST_ACTION_EVENT, {
        detail: {
          action: "reading-assist",
          hostId: "host-ra",
          source: {
            source: { sourceType: "text", documentId: "doc-1", sourceId: "doc-1" },
            contentType: "document",
            contentId: "doc-1",
            contentFingerprint: "fp-1",
            text,
          },
          selectedText: text,
          profileId: "profile-1",
          languageTag,
          origin: "reader",
        },
      }),
    );
  });
}

describe("LanguageReadingAssistOverlay", () => {
  let contentRoot: HTMLDivElement;

  beforeEach(() => {
    hostMocks.targetLanguage = "ja";
    hostMocks.text = "日本語を読む";
    hostMocks.knownItems = [];
    hostMocks.aiAvailable = false;
    contentRoot = document.createElement("div");
    contentRoot.setAttribute("data-language-content-root", "true");
    contentRoot.textContent = hostMocks.text;
    document.body.appendChild(contentRoot);
  });

  afterEach(() => {
    contentRoot.remove();
    vi.clearAllMocks();
  });

  it("defaults to Ruby/Furigana for Japanese, switches to Word Segmentation, filters known words, and restores DOM on close", async () => {
    hostMocks.knownItems = [
      { id: "k1", normalizedForm: "日本語", canonicalForm: "日本語", lemma: "日本語", knowledgeState: "known" },
    ];

    render(<LanguageReadingAssistOverlay />);
    dispatchOpen("日本語を読む", "ja");

    const overlay = screen.getByRole("region", { name: "Reading assist" });
    const rubyBtn = await within(overlay).findByRole("button", { name: "Ruby / Furigana" });
    expect(rubyBtn).toHaveAttribute("aria-pressed", "true");

    await waitFor(() => {
      expect(within(overlay).getByText(/にほんご/)).toBeInTheDocument();
      expect(within(overlay).getByText(/よむ/)).toBeInTheDocument();
    });
    expect(contentRoot.querySelectorAll("[data-language-reading-assist]")).toHaveLength(2);

    // Filter out known words ("日本語")
    const hideKnownBtn = within(overlay).getByRole("button", { name: "Hide known words" });
    fireEvent.click(hideKnownBtn);
    expect(hideKnownBtn).toHaveAttribute("aria-pressed", "true");

    await waitFor(() => {
      expect(within(overlay).queryByText(/にほんご/)).not.toBeInTheDocument();
      expect(within(overlay).getByText(/よむ/)).toBeInTheDocument();
      expect(contentRoot.querySelectorAll("[data-language-reading-assist]")).toHaveLength(1);
    });

    // Switch back to All words, then switch mode to Word Segmentation
    fireEvent.click(within(overlay).getByRole("button", { name: "All words" }));
    const segBtn = within(overlay).getByRole("button", { name: "Word Segmentation" });
    fireEvent.click(segBtn);
    expect(segBtn).toHaveAttribute("aria-pressed", "true");

    await waitFor(() => {
      expect(within(overlay).getByText(/Marked 3 word boundaries/)).toBeInTheDocument();
    });
    expect(contentRoot.textContent).toBe("日本語を読む");

    // Closing clears DOM decorations and restores exact source text
    fireEvent.click(within(overlay).getByRole("button", { name: "Close reading assist" }));
    expect(contentRoot.querySelectorAll("[data-language-reading-assist]")).toHaveLength(0);
    expect(contentRoot.textContent).toBe("日本語を読む");
  });

  it("auto-selects Transliteration for Chinese/Korean, Bidi/RTL for Arabic, and AI Gloss for other languages when AI is available", async () => {
    hostMocks.targetLanguage = "zh-Hans";
    hostMocks.text = "我喜欢学习中文";
    contentRoot.textContent = hostMocks.text;

    const { unmount } = render(<LanguageReadingAssistOverlay />);
    dispatchOpen(hostMocks.text, "zh-Hans");

    const translitBtn = await screen.findByRole("button", { name: "Transliteration / Pinyin" });
    expect(translitBtn).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => {
      const overlay = screen.getByRole("region", { name: "Reading assist" });
      expect(within(overlay).getByText(/xuéxí/)).toBeInTheDocument();
    });
    unmount();

    hostMocks.targetLanguage = "ar";
    hostMocks.text = "والْكِتَابُ في المدرسة";
    contentRoot.textContent = hostMocks.text;

    const arRender = render(<LanguageReadingAssistOverlay />);
    dispatchOpen(hostMocks.text, "ar");

    const bidiBtn = await screen.findByRole("button", { name: "Bidi / RTL" });
    expect(bidiBtn).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => {
      const overlay = screen.getByRole("region", { name: "Reading assist" });
      expect(within(overlay).getByText(/وال\+/)).toBeInTheDocument();
    });
    arRender.unmount();

    hostMocks.targetLanguage = "es";
    hostMocks.text = "Hola mundo";
    hostMocks.aiAvailable = true;
    contentRoot.textContent = hostMocks.text;

    render(<LanguageReadingAssistOverlay />);
    dispatchOpen(hostMocks.text, "es");

    const glossBtn = await screen.findByRole("button", { name: "AI Gloss" });
    expect(glossBtn).toHaveAttribute("aria-pressed", "true");
  });
});
