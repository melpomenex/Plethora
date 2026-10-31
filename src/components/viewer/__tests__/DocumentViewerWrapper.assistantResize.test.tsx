/**
 * Assistant-resize → reader layout wiring (#17) in the document-viewer
 * layout: the AssistantPanel's `onWidthChange` is consumed by the host and
 * the reader retains a minimum usable width (`READER_MIN_WIDTH`) so a resize
 * can never collapse the reading column.
 */
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { READER_MIN_WIDTH } from "../../assistant/AssistantPanel";
import { DocumentViewer } from "../DocumentViewerWrapper";

const capturedProps = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }));

const capturedViewerProps = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }));

vi.mock("../DocumentViewer", () => ({
  DocumentViewer: (props: Record<string, unknown>) => {
    capturedViewerProps.props.push(props);
    return <div data-testid="base-viewer" />;
  },
}));

vi.mock("../../assistant/AssistantPanel", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../assistant/AssistantPanel")>();
  return {
    ...original,
    AssistantPanel: (props: Record<string, unknown>) => {
      capturedProps.props.push(props);
      return <div data-testid="assistant-panel" />;
    },
  };
});

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

describe("DocumentViewerWrapper assistant resize wiring", () => {
  it("consumes the AssistantPanel onWidthChange callback", () => {
    capturedProps.props.length = 0;
    render(<DocumentViewer documentId="doc-1" />);

    const assistantProps = capturedProps.props[0];
    expect(assistantProps).toBeDefined();
    expect(typeof assistantProps.onWidthChange).toBe("function");
  });

  it("keeps the reader at its minimum usable width while the assistant resizes", () => {
    render(<DocumentViewer documentId="doc-1" />);
    const baseViewer = screen.getByTestId("base-viewer");
    const reader = baseViewer.parentElement as HTMLElement;
    expect(reader.style.minWidth).toBe(`${READER_MIN_WIDTH}px`);
    expect(Number.parseInt(reader.style.minWidth, 10)).toBeGreaterThanOrEqual(300);
  });

  it("preserves reader locator and progress when assistant resizes without emitting premature zero position", () => {
    capturedProps.props.length = 0;
    capturedViewerProps.props.length = 0;
    const onScrollSpy = vi.fn();
    const jump = { kind: "pdf" as const, pageNumber: 5 };

    render(
      <DocumentViewer
        documentId="doc-1"
        initialJump={jump}
        onScrollPositionChange={onScrollSpy}
      />
    );

    const latestViewerProps = capturedViewerProps.props[capturedViewerProps.props.length - 1];
    expect(latestViewerProps.initialJump).toEqual(jump);

    // Simulate viewer reporting active scroll progress (e.g. Page 5, 42%)
    const onScrollChange = latestViewerProps.onScrollPositionChange as (state: { pageNumber: number; scrollPercent: number }) => void;
    expect(typeof onScrollChange).toBe("function");
    act(() => {
      onScrollChange({ pageNumber: 5, scrollPercent: 42 });
    });
    expect(onScrollSpy).toHaveBeenCalledWith({ pageNumber: 5, scrollPercent: 42 });

    // Assistant resizes: onWidthChange is called
    const assistantProps = capturedProps.props[0];
    const onWidthChange = assistantProps.onWidthChange as (width: number) => void;
    onWidthChange(520);

    // No premature zero-position was emitted during resize
    expect(onScrollSpy).not.toHaveBeenCalledWith(expect.objectContaining({ pageNumber: 1, scrollPercent: 0 }));
    expect(onScrollSpy).not.toHaveBeenCalledWith(expect.objectContaining({ pageNumber: 0 }));
  });

  it("in queue embedded context, embeds viewer cleanly and preserves position without assistant panel", () => {
    capturedViewerProps.props.length = 0;
    const { queryByTestId } = render(
      <DocumentViewer documentId="doc-queue-1" embedded={true} />
    );

    expect(queryByTestId("assistant-panel")).toBeNull();
    const latestViewerProps = capturedViewerProps.props[capturedViewerProps.props.length - 1];
    expect(latestViewerProps.embedded).toBe(true);
  });
});
