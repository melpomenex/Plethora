import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocumentViewer } from "../DocumentViewerWrapper";
import type { VideoViewerContext } from "../../../lib/ai/assistant/scopes";

const capturedAssistantProps = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }));
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
      capturedAssistantProps.props.push(props);
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
  const state = {
    currentDocument: {
      id: "doc-123",
      title: "Test Video Document",
      fileType: "youtube",
    },
    documents: [],
  };
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
      maxTokens: 50000,
      model: "test-model",
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

describe("DocumentViewerWrapper video context parity", () => {
  it("exposes untruncated transcript and ready-full status to AssistantPanel", async () => {
    capturedAssistantProps.props = [];
    capturedViewerProps.props = [];

    render(<DocumentViewer documentId="doc-123" />);

    expect(capturedViewerProps.props.length).toBeGreaterThan(0);
    const viewerProp = capturedViewerProps.props[capturedViewerProps.props.length - 1];
    const onVideoContextChange = viewerProp.onVideoContextChange as (ctx: VideoViewerContext) => void;
    expect(typeof onVideoContextChange).toBe("function");

    const fullTranscript = "00:00 Introduction\nThis is the complete 2-hour lecture on consciousness.\n".repeat(200);

    act(() => {
      onVideoContextChange({
        videoId: "yt-consciousness",
        title: "Michael Pollan on Consciousness",
        duration: 7200,
        currentTime: 42,
        transcript: fullTranscript,
        transcriptStatus: "ready-full",
      });
    });

    const latestAssistantProps = capturedAssistantProps.props[capturedAssistantProps.props.length - 1];
    expect(latestAssistantProps).toBeDefined();

    const context = latestAssistantProps.context as any;
    expect(context).toBeDefined();
    expect(context.type).toBe("video");
    expect(context.transcriptStatus).toBe("ready-full");
    expect(context.content).toBe(fullTranscript.trim());
    expect(context.coverage).toBe("full");
    expect(context.metadata?.videoId).toBe("yt-consciousness");
    expect(context.metadata?.duration).toBe(7200);
  });
});
