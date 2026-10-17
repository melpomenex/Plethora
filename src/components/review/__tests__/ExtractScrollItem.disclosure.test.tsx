/**
 * Extract card progressive-disclosure behaviour.
 *
 * The card must never summarize on its own: viewing an extract is not consent
 * for an AI call. These tests pin the opt-in gate and the one-based level
 * vocabulary shared by the header indicator and the content badge.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ExtractScrollItem } from "../ExtractScrollItem";
import type { Extract } from "../../../api/extracts";
import { defaultSettings, useSettingsStore } from "../../../stores/settingsStore";

const mocks = vi.hoisted(() => ({
  generateProgressiveSummaries: vi.fn(),
}));

vi.mock("../../../api/ai", async () => {
  const actual = await vi.importActual<typeof import("../../../api/ai")>("../../../api/ai");
  return {
    ...actual,
    generateProgressiveSummaries: mocks.generateProgressiveSummaries,
  };
});

// Referentially stable translator, matching the real hook's useCallback
// contract — otherwise the mount effect re-runs on every render.
function translate(key: string, vars?: Record<string, unknown>) {
  switch (key) {
    case "extractScrollItem.aiSummaryLevel":
      return `AI Summary - Level ${vars?.current}/${vars?.total}`;
    case "extractScrollItem.level":
      return `Level ${vars?.current}/${vars?.total}`;
    case "extractScrollItem.fullContent":
      return "Full content";
    case "extractScrollItem.revealingPercent":
      return `Revealing ${vars?.count}%`;
    default:
      return key;
  }
}

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({ t: translate }),
}));

const CONTENT =
  "Hamilton's priority alarms interrupted displays to warn of emergency. " +
  "Garman recognized the errors, shouted go, and the mission continued.";

function makeExtract(overrides: Partial<Extract> = {}): Extract {
  return {
    id: "extract-1",
    document_id: "doc-1",
    content: CONTENT,
    progressive_disclosure_level: 0,
    max_disclosure_level: 3,
    progressive_summaries: undefined,
    date_created: "2026-01-01T00:00:00Z",
    date_modified: "2026-01-01T00:00:00Z",
    tags: [],
    review_count: 0,
    reps: 0,
    ...overrides,
  };
}

function setSummariesEnabled(enabled: boolean) {
  const settings = JSON.parse(JSON.stringify(defaultSettings));
  settings.ai.aiControls.extractProgressiveSummaries = enabled;
  useSettingsStore.setState({ settings });
}

function renderItem(extract: Extract) {
  return render(
    <ExtractScrollItem
      extract={extract}
      documentTitle="Margaret Hamilton (software engineer) - Wikipedia - Extract"
      onRate={vi.fn()}
      onCreateCloze={vi.fn()}
      onCreateQA={vi.fn()}
    />
  );
}

describe("ExtractScrollItem progressive disclosure", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.generateProgressiveSummaries.mockReset();
    mocks.generateProgressiveSummaries.mockResolvedValue([
      { level: 1, summary: "A short summary.", word_count: 4 },
      { level: 2, summary: "A medium summary.", word_count: 4 },
    ]);
    setSummariesEnabled(false);
  });

  it("never calls the AI provider when the setting is off, and shows full editable text", async () => {
    renderItem(makeExtract());

    await waitFor(() => {
      expect(screen.getAllByRole("textbox").length).toBeGreaterThan(0);
    });

    expect(mocks.generateProgressiveSummaries).not.toHaveBeenCalled();
    const contentEditor = screen.getAllByRole("textbox")[0] as HTMLTextAreaElement;
    expect(contentEditor.value).toBe(CONTENT);
    expect(screen.queryByText(/AI Summary/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Level /)).not.toBeInTheDocument();
  });

  it("shows the cached summary and matching one-based badges when enabled", async () => {
    setSummariesEnabled(true);
    renderItem(
      makeExtract({
        progressive_summaries: [
          { level: 1, summary: "A short summary.", word_count: 4 },
          { level: 2, summary: "A medium summary.", word_count: 4 },
        ],
      })
    );

    expect(await screen.findByText("A short summary.")).toBeInTheDocument();
    expect(screen.getByText("AI Summary - Level 1/3")).toBeInTheDocument();
    expect(screen.getByText("Level 1/3")).toBeInTheDocument();
    // Cached summaries are served without another provider call.
    expect(mocks.generateProgressiveSummaries).not.toHaveBeenCalled();
  });

  it("generates once when enabled and nothing is cached", async () => {
    setSummariesEnabled(true);
    renderItem(makeExtract());

    await waitFor(() => {
      expect(mocks.generateProgressiveSummaries).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByText("A short summary.")).toBeInTheDocument();
    });
  });

  it("uses the same final stage for the header and content badges", async () => {
    setSummariesEnabled(true);
    renderItem(
      makeExtract({
        progressive_disclosure_level: 2,
        progressive_summaries: [
          { level: 1, summary: "A short summary.", word_count: 4 },
          { level: 2, summary: "A medium summary.", word_count: 4 },
        ],
      })
    );

    expect(screen.getByText("Level 3/3")).toBeInTheDocument();
    expect(screen.getByText("Full content")).toBeInTheDocument();
    const contentEditor = screen.getAllByRole("textbox")[0] as HTMLTextAreaElement;
    expect(contentEditor.value).toBe(CONTENT);
  });
});
