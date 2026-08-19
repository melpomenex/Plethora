import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  dispatchRemoteMediaCommand,
  executeStudyAction,
  type RemoteMediaContext,
} from "../remoteMediaDispatcher";
import { useSettingsStore } from "../../stores/settingsStore";
import { createExtract } from "../../api/extracts";
import { addListeningSessionItem } from "../../api/listeningSessions";

vi.mock("../../api/extracts", () => ({
  createExtract: vi.fn(async (payload) => ({
    id: "ext-test-1",
    ...payload,
  })),
}));

vi.mock("../../api/listeningSessions", () => ({
  addListeningSessionItem: vi.fn(async (item) => item),
}));

vi.mock("../audioFeedback", () => ({
  playChime: vi.fn(),
  duckAudio: vi.fn(),
}));

describe("Remote Media Dispatcher & Hands-Free Study Mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseContext: RemoteMediaContext = {
    documentId: "doc-1",
    documentTitle: "Quantum Mechanics and Epistemology",
    editionId: "ed-1",
    sessionId: "sess-1",
    audioElement: null,
    currentTimestampSec: 25.0,
    anchors: [
      {
        id: "anc-1",
        sectionId: "sec-1",
        audioStartSec: 0,
        audioEndSec: 20,
        sourceStartAnchor: "0",
        sourceEndAnchor: "100",
        textContent: "First foundation of knowledge.",
      },
      {
        id: "anc-2",
        sectionId: "sec-1",
        audioStartSec: 20,
        audioEndSec: 40,
        sourceStartAnchor: "101",
        sourceEndAnchor: "250",
        textContent: "Wave-particle duality manifests in observation.",
      },
    ],
    onPlayPause: vi.fn(),
    onNextChapter: vi.fn(),
    onPrevChapter: vi.fn(),
    onSeekRelative: vi.fn(),
  };

  it("routes commands normally when Hands-Free Study Mode is disabled", () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        handsFreeStudy: {
          ...useSettingsStore.getState().settings.handsFreeStudy,
          enabled: false,
        },
      },
    });

    dispatchRemoteMediaCommand("Next", baseContext);
    expect(baseContext.onNextChapter).toHaveBeenCalled();

    dispatchRemoteMediaCommand("SeekForward", baseContext);
    expect(baseContext.onSeekRelative).toHaveBeenCalledWith(15);
  });

  it("captures smart extract when single press arrives in Hands-Free Study Mode", async () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        handsFreeStudy: {
          ...useSettingsStore.getState().settings.handsFreeStudy,
          enabled: true,
          singlePressAction: "smart_extract",
        },
      },
    });

    await executeStudyAction("smart_extract", baseContext);

    expect(createExtract).toHaveBeenCalledWith(
      expect.objectContaining({
        document_id: "doc-1",
        content: expect.stringContaining("Wave-particle duality"),
        tags: ["audio-extract", "hands-free"],
      })
    );

    expect(addListeningSessionItem).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess-1",
        markerType: "extract",
      })
    );
  });

  it("records bookmark when bookmark action is executed", async () => {
    await executeStudyAction("bookmark", baseContext);

    expect(addListeningSessionItem).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess-1",
        markerType: "bookmark",
      })
    );
  });

  it("records confusion marker when mark_confusing action is executed", async () => {
    await executeStudyAction("mark_confusing", baseContext);

    expect(addListeningSessionItem).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess-1",
        markerType: "confusing",
      })
    );
  });
});
