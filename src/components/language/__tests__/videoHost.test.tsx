import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { LanguageVideoHost } from "../LanguageVideoHost";
import { supportsVideoLayout } from "../../../lib/languageVideo";

const translateMock = vi.fn();

vi.mock("../../../contexts/LanguageLearningHostContext", () => ({
  useOptionalLanguageLearningHost: () => ({
    snapshot: {
      hostId: "host-video",
      surface: "video",
      status: "ready",
      source: {
        source: { sourceType: "transcript", mediaId: "vid-1", sourceId: "vid-1" },
        contentType: "video",
        contentId: "vid-1",
        contentFingerprint: "fp-1",
        text: "Hola mundo",
      },
      profile: {
        id: "prof-1",
        targetLanguage: "es",
        baseLanguage: "en",
        proficiency: "A2",
      },
      capabilities: {},
      epoch: 1,
    },
  }),
}));

vi.mock("../../../api/languageLexicon", () => ({
  listLanguageLexicalEntries: vi.fn(async () => ({ items: [], hasMore: false })),
}));

vi.mock("../../../lib/languageTranslation", () => ({
  createTranslationService: () => ({
    translate: (...args: unknown[]) => translateMock(...args),
  }),
}));

vi.mock("../../../hooks/useTTS", () => ({
  useTTS: () => ({ speak: vi.fn(), stop: vi.fn() }),
}));

describe("LanguageVideoHost & video session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    delete document.documentElement.dataset.theme;
  });

  it("supportsVideoLayout rejects e-ink and non-reduced-motion mobile", () => {
    expect(supportsVideoLayout("desktop", false)).toBe(true);
    expect(supportsVideoLayout("e-ink", false)).toBe(false);
    expect(supportsVideoLayout("mobile", false)).toBe(false);
    expect(supportsVideoLayout("mobile", true)).toBe(true);
  });

  it("degrades gracefully in e-ink mode", () => {
    document.documentElement.dataset.theme = "eink";
    render(
      <LanguageVideoHost
        videoId="vid-1"
        sourceFingerprint="fp-1"
        segments={[{ id: "seg-1", text: "Hola mundo", start: 0, end: 2 }]}
        currentTime={0.5}
        onSeek={vi.fn()}
      />,
    );
    expect(screen.getByText(/unavailable in e-ink mode/i)).toBeInTheDocument();
  });

  it("supports hidden translation reveal and offline translation retry", async () => {
    translateMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ translatedText: "Hello world" });
    render(
      <LanguageVideoHost
        videoId="vid-1"
        sourceFingerprint="fp-1"
        segments={[{ id: "seg-1", text: "Hola mundo", start: 0, end: 2 }]}
        currentTime={0.5}
        onSeek={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Language video subtitle mode"), { target: { value: "hidden" } });
    fireEvent.click(screen.getByRole("button", { name: "Reveal translation" }));

    await waitFor(() => expect(screen.getByText("Base translation unavailable offline.")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("Hello world")).toBeInTheDocument());
  });
});
