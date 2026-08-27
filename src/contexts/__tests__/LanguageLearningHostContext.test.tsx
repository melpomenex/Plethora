import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LanguageLearningHostProvider, useLanguageLearningHost } from "../LanguageLearningHostContext";
import type { LanguageHostSource } from "../../lib/languageHost";

const source: LanguageHostSource = {
  contentType: "document",
  contentId: "doc-1",
  contentFingerprint: "doc-1:v1",
  text: "Hola mundo",
  source: { sourceType: "text", documentId: "doc-1", sourceId: "doc-1", contentFingerprint: "doc-1:v1" },
};

const profile = {
  id: "profile-1",
  accountId: "local",
  workspaceId: "default",
  name: "Spanish",
  targetLanguage: "es",
  baseLanguage: "en",
  preferences: { highlightDensity: "balanced", showTranslation: true, showExplanation: true, translationProvider: "local", explanationProvider: "local" },
  processingConfig: { provider: "local", offlineCapable: true, dictionaryEnabled: true, ttsEnabled: true, transcriptionEnabled: true },
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  lifecycle: "active" as const,
  version: 1,
};

vi.mock("../../stores/languageProfileStore", () => ({
  useLanguageProfileStore: (selector: (state: { resolveContext: () => Promise<{ profile: typeof profile; association: null; source: string; contextVersion: number } | null> }) => unknown) =>
    selector({
      resolveContext: async () => ({
        profile,
        association: null,
        source: "confirmed_association",
        contextVersion: 1,
      }),
    }),
}));

function Probe({ onStatus }: { onStatus: (status: string) => void }) {
  const { snapshot } = useLanguageLearningHost();
  onStatus(snapshot.status);
  return <div role="status">{snapshot.status}</div>;
}

describe("LanguageLearningHostProvider", () => {
  it("enables language mode without exceeding React update depth", async () => {
    const statuses: string[] = [];
    const onStatus = (status: string) => {
      if (statuses[statuses.length - 1] !== status) statuses.push(status);
    };

    const { rerender } = render(
      <LanguageLearningHostProvider
        hostId="host-1"
        surface="reader"
        source={source}
        languageModeEnabled={false}
        resolveCapabilities={() => ({ practice: { name: "practice", available: true, offline: true } })}
      >
        <Probe onStatus={onStatus} />
      </LanguageLearningHostProvider>,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole("status")).toHaveTextContent("disabled");

    rerender(
      <LanguageLearningHostProvider
        hostId="host-1"
        surface="reader"
        source={source}
        languageModeEnabled
        resolveCapabilities={() => ({ practice: { name: "practice", available: true, offline: true } })}
      >
        <Probe onStatus={onStatus} />
      </LanguageLearningHostProvider>,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole("status")).toHaveTextContent("ready");
    expect(statuses.length).toBeLessThan(8);
  });
});
