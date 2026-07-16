import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen, waitFor } from "../../test/utils";

const mocks = vi.hoisted(() => ({
  getDocumentsWithProgress: vi.fn(),
}));

vi.mock("../../api/position", () => ({
  getDocumentsWithProgress: mocks.getDocumentsWithProgress,
}));

vi.mock("../../lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, string | number>) => {
      if (key === "continueReading.imported") return `Imported ${vars?.relative ?? ""}`.trim();
      if (key === "continueReading.importTimeUnavailable") return "Import time unavailable";
      const labels: Record<string, string> = {
        "continueReading.title": "Continue Reading",
        "continueReading.subtitle": "Pick up where you left off",
        "continueReading.loading": "Loading continue reading...",
        "continueReading.failed": "Failed to load documents",
        "continueReading.noItems": "No items available",
        "continueReading.addDocuments": "Add documents or notes to see them here",
        "continueReading.complete": "complete",
        "continueReading.resume": "Resume",
        "common.retry": "Retry",
      };
      return labels[key] ?? key;
    },
  }),
}));

import { ContinueReadingPage } from "../ContinueReadingPage";

describe("ContinueReadingPage imported time", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 6, 16, 12, 0, 0));
    mocks.getDocumentsWithProgress.mockResolvedValue([
      {
        id: "imported",
        progress: 25,
        title: "Imported document",
        date_added: Date.UTC(2026, 6, 14, 12, 0, 0),
        date_modified: Date.UTC(2026, 6, 15, 12, 0, 0),
      },
      {
        id: "legacy",
        progress: 10,
        title: "Legacy document",
        date_added: null,
        date_modified: Date.UTC(2026, 6, 16, 11, 55, 0),
      },
      {
        id: "unknown",
        progress: 0,
        title: "Unknown document",
        date_added: null,
        date_modified: null,
      },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mocks.getDocumentsWithProgress.mockReset();
  });

  it("uses import time, falls back to modification time, and labels both explicitly", async () => {
    renderWithProviders(<ContinueReadingPage />);

    expect(await screen.findByTitle("Imported 2d ago")).toBeInTheDocument();
    expect(screen.getByLabelText("Imported 2d ago")).toBeInTheDocument();
    expect(screen.getByTitle("Imported 5m ago")).toBeInTheDocument();
  });

  it("uses an accessible unavailable label when neither timestamp is valid", async () => {
    renderWithProviders(<ContinueReadingPage />);

    await waitFor(() => expect(screen.getByTitle("Import time unavailable")).toBeInTheDocument());
    expect(screen.getByLabelText("Import time unavailable")).toBeInTheDocument();
  });
});
