import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { DocumentViewer as DocumentViewerWrapper } from "../DocumentViewerWrapper";

const capturedViewerProps = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }));

vi.mock("../DocumentViewer", () => ({
  DocumentViewer: (props: Record<string, unknown>) => {
    capturedViewerProps.props.push(props);
    return <div data-testid="base-viewer" />;
  },
}));

vi.mock("../../assistant/AssistantPanel", () => ({
  AssistantPanel: () => <div data-testid="assistant-panel" />,
  READER_MIN_WIDTH: 300,
}));

vi.mock("../../assistant/PwaAssistantButton", () => ({
  PwaAssistantButton: () => null,
}));

vi.mock("../../../hooks/useFormFactor", () => ({
  useFormFactor: () => ({ formFactor: "desktop" }),
}));

vi.mock("../../../hooks/useReadingSessionTracker", () => ({
  useReadingSessionTracker: () => undefined,
}));

vi.mock("../../common/Tabs", () => ({
  useIsActiveTab: () => true,
}));

vi.mock("../../../stores/documentStore", () => {
  const state = { currentDocument: null, documents: [] };
  return {
    useDocumentStore: Object.assign(
      (selector: (s: typeof state) => unknown) => selector(state),
      {
        getState: () => state,
        subscribe: vi.fn(),
        setState: vi.fn(),
      }
    ),
  };
});

vi.mock("../../../stores/settingsStore", () => {
  const settings = {
    general: { language: "en" },
    ai: {
      maxTokens: 2000,
      model: "gpt-4o-mini",
      pwaAssistantButtonEnabled: false,
      pwaAssistantButtonSide: "right",
    },
    documents: { ocr: { autoOCR: false, autoExtractOnLoad: false } },
  };
  const state = { settings };
  return {
    useSettingsStore: Object.assign(
      (selector: (s: typeof state) => unknown) => selector(state),
      {
        getState: () => state,
        subscribe: vi.fn(),
        setState: vi.fn(),
      }
    ),
  };
});

vi.mock("../../../stores/documentOutlineStore", () => ({
  useDocumentOutlineStore: () => ({ setMediaSections: vi.fn() }),
}));

vi.mock("../../../lib/pwa", () => ({
  isPWA: () => false,
}));

vi.mock("../../../utils/audioCaptureNavigation", () => ({
  consumeAskPlethora: () => null,
}));

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "../../../..");

function readSource(relative: string): string {
  return readFileSync(join(repoRoot, relative), "utf8");
}

describe("Rating Orbs Gating (hide-rating-orbs-outside-queue)", () => {
  beforeEach(() => {
    capturedViewerProps.props.length = 0;
  });

  describe("DocumentViewerWrapper prop forwarding", () => {
    it("forwards openedFrom and hideRatingOrbs faithfully to DocumentViewer", async () => {
      await act(async () => {
        render(
          <DocumentViewerWrapper
            documentId="doc-123"
            openedFrom="queue"
            hideRatingOrbs={false}
          />
        );
      });

      expect(capturedViewerProps.props.length).toBeGreaterThan(0);
      const forwarded = capturedViewerProps.props[0];
      expect(forwarded.openedFrom).toBe("queue");
      expect(forwarded.hideRatingOrbs).toBe(false);
    });

    it("forwards undefined openedFrom when opened as a standalone reader tab", async () => {
      await act(async () => {
        render(
          <DocumentViewerWrapper
            documentId="doc-456"
          />
        );
      });

      expect(capturedViewerProps.props.length).toBeGreaterThan(0);
      const forwarded = capturedViewerProps.props[0];
      expect(forwarded.openedFrom).toBeUndefined();
    });
  });

  describe("DocumentViewer source invariants for rating orbs and shortcuts", () => {
    const source = readSource("src/components/viewer/DocumentViewer.tsx");

    it("requires openedFrom === 'queue' in shouldHideRatingOrbs", () => {
      // Must whitelist 'queue' rather than blacklisting 'documents'
      expect(source).toContain('const shouldHideRatingOrbs = hideRatingOrbs || openedFrom !== "queue";');
      expect(source).not.toContain('const shouldHideRatingOrbs = hideRatingOrbs || openedFrom === "documents";');
    });

    it("gates rating keyboard shortcuts (1-4) by !shouldHideRatingOrbs and openedFrom === 'queue'", () => {
      const match = source.match(/Rating shortcuts \(1-4\)[\s\S]{0,300}?if\s*\(([^)]+)\)/);
      expect(match).not.toBeNull();
      const condition = match![1];
      expect(condition).toContain('!shouldHideRatingOrbs');
      expect(condition).toContain('openedFrom === "queue"');
    });

    it("renders rating orbs only when !shouldHideRatingOrbs and isDocumentInQueue", () => {
      const match = source.match(/Orb Rating Buttons[\s\S]{0,200}?\{([^&]+(?:&&[^&]+)*)\s*&&/);
      expect(match).not.toBeNull();
      const condition = match![0];
      expect(condition).toContain('!shouldHideRatingOrbs');
      expect(condition).toContain('isDocumentInQueue');
    });
  });

  describe("Behavior evaluation of shouldHideRatingOrbs logic", () => {
    function computeShouldHideRatingOrbs(options: {
      hideRatingOrbs?: boolean;
      openedFrom?: string;
    }): boolean {
      const { hideRatingOrbs = false, openedFrom } = options;
      return hideRatingOrbs || openedFrom !== "queue";
    }

    it("hides rating orbs when openedFrom is undefined (e.g. Continue Reading, Search, recents, restored tabs)", () => {
      expect(computeShouldHideRatingOrbs({ openedFrom: undefined })).toBe(true);
    });

    it("hides rating orbs when openedFrom is 'documents'", () => {
      expect(computeShouldHideRatingOrbs({ openedFrom: "documents" })).toBe(true);
    });

    it("hides rating orbs when openedFrom is any other non-queue string", () => {
      expect(computeShouldHideRatingOrbs({ openedFrom: "recent" })).toBe(true);
      expect(computeShouldHideRatingOrbs({ openedFrom: "continue-reading" })).toBe(true);
      expect(computeShouldHideRatingOrbs({ openedFrom: "search" })).toBe(true);
    });

    it("shows rating orbs when openedFrom === 'queue' and hideRatingOrbs is false", () => {
      expect(computeShouldHideRatingOrbs({ openedFrom: "queue", hideRatingOrbs: false })).toBe(false);
    });

    it("hides rating orbs when openedFrom === 'queue' but hideRatingOrbs is true (e.g. QueueScrollPage)", () => {
      expect(computeShouldHideRatingOrbs({ openedFrom: "queue", hideRatingOrbs: true })).toBe(true);
    });
  });
});
