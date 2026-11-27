import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StudyModeWorkspace } from "../../../../components/viewer/StudyModeWorkspace";
import * as studyModeApi from "../../../../api/study-mode";
import {
  clearCachedStudyMedia,
  loadCachedStudyMedia,
  saveCachedStudyMedia,
} from "../studyMediaCache";
import { synthesizeStudySegment } from "../studyTtsBridge";

vi.mock("../../../../components/tutor/TutorSheet", () => ({
  TutorSheet: () => null,
}));

describe("Wave 4: Playable Audio Lessons, Narrated Slides & End-to-End Validation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("caches synthesized audio segments locally and reuses cache offline without regenerating", async () => {
    const first = await synthesizeStudySegment({
      artifactId: "audio-art-1",
      kind: "audio_script",
      scopeKey: "doc:doc-1|rev:rev-1",
      sourceRevision: "rev-1",
      index: 0,
      text: "Mitochondria convert chemical energy into ATP.",
      isOffline: false,
    });
    expect(first.fromCache).toBe(false);
    expect(first.durationSec).toBeGreaterThanOrEqual(2);

    const manifest = loadCachedStudyMedia("audio-art-1", "rev-1");
    expect(manifest).not.toBeNull();
    expect(manifest?.segments.length).toBe(1);

    // Offline reuse hits local cache immediately
    const second = await synthesizeStudySegment({
      artifactId: "audio-art-1",
      kind: "audio_script",
      scopeKey: "doc:doc-1|rev:rev-1",
      sourceRevision: "rev-1",
      index: 0,
      text: "Mitochondria convert chemical energy into ATP.",
      isOffline: true,
    });
    expect(second.fromCache).toBe(true);

    clearCachedStudyMedia("audio-art-1");
    expect(loadCachedStudyMedia("audio-art-1", "rev-1")).toBeNull();
  });

  it("renders Playable Audio Lesson with play/pause, speed, seek, transcript highlight, and offline cache badge", async () => {
    const audioArtifact = {
      id: "art-audio-1",
      sessionId: "sess-w4",
      artifactType: "audio_script",
      schemaVersion: 1,
      scopeKey: "doc:doc-w4|rev:rev-1",
      sourceIds: ["doc-w4"],
      sourceRevision: "rev-1",
      anchors: [
        {
          sourceId: "doc-w4",
          sourceRevision: "rev-1",
          quote: "Mitochondria produce ATP",
          locator: { kind: "text", scrollPercent: 0, textQuote: "Mitochondria produce ATP" },
        },
      ],
      segmentIds: [],
      conceptIds: [],
      objectiveIds: [],
      planId: null,
      planVersionId: null,
      preferenceFingerprint: "",
      taskId: "study-mode-audio-script",
      taskVersion: "1",
      promptVersion: "1",
      providerId: "local",
      modelId: "test",
      knowledgeAuthority: "source-only" as const,
      validationStatus: "verified",
      qualityEval: null,
      payload: {
        title: "Cell Energy Dialogue",
        mode: "teacher_student",
        turns: [
          { speaker: "student", text: "Do ribosomes make ATP?", misconceptionCorrected: true },
          { speaker: "teacher", text: "Actually, mitochondria produce ATP; ribosomes build proteins." },
        ],
      },
      isStale: false,
      isLocked: false,
      dismissed: false,
      createdAt: "2026-11-26T00:00:00Z",
      updatedAt: "2026-11-26T00:00:00Z",
    };

    const slidesArtifact = {
      ...audioArtifact,
      id: "art-slides-1",
      artifactType: "slides",
      payload: {
        title: "ATP Visual Deck",
        slides: [
          {
            title: "Energy Currency",
            objective: "Understand ATP role",
            bullets: ["ATP stores usable cellular energy", "Synthesized in mitochondria"],
            narration: "Cells rely on ATP as their immediate energy currency.",
            citations: [{ sourceId: "doc-w4", quote: "Mitochondria produce ATP" }],
          },
          {
            title: "Oxidative Phosphorylation",
            objective: "Trace electron transport",
            bullets: ["Proton gradient drives ATP synthase"],
            narration: "The inner mitochondrial membrane powers ATP synthase.",
            citations: [{ sourceId: "doc-w4", quote: "Mitochondria produce ATP" }],
          },
        ],
      },
    };

    // Pre-seed cached media manifest to verify offline reuse indicator
    saveCachedStudyMedia({
      artifactId: "art-audio-1",
      kind: "audio_script",
      scopeKey: "doc:doc-w4|rev:rev-1",
      sourceRevision: "rev-1",
      lastPositionIndex: 0,
      segments: [],
      cachedAt: "2026-11-26T00:00:00Z",
    });

    vi.spyOn(studyModeApi, "findStudyModeSessionByScope").mockResolvedValue(null);
    vi.spyOn(studyModeApi, "upsertStudyModeSession").mockResolvedValue({
      id: "sess-w4",
      scopeKind: "standalone_document",
      documentId: "doc-w4",
      studyPlanId: null,
      planVersionId: null,
      topicId: null,
      segmentId: null,
      sourceRevision: "rev-1",
      knowledgeAuthority: "source-only",
      activeView: "learn",
      lastLocatorJson: null,
      status: "active",
      createdAt: "2026-11-26T00:00:00Z",
      updatedAt: "2026-11-26T00:00:00Z",
    });
    const listArtSpy = vi.spyOn(studyModeApi, "listStudyModeArtifacts").mockResolvedValue([
      audioArtifact,
      slidesArtifact,
    ]);
    vi.spyOn(studyModeApi, "listStudyLearnerPreferences").mockResolvedValue([]);

    const onJump = vi.fn();
    render(
      <StudyModeWorkspace
        documentId="doc-w4"
        documentTitle="Bio Visuals"
        sourceRevision="rev-1"
        passageText="Mitochondria produce ATP for cellular energy."
        onJumpToSource={onJump}
        onExitStudyMode={() => {}}
      />
    );

    await waitFor(() => expect(listArtSpy).toHaveBeenCalled());

    // Switch to Explore -> Audio Lesson
    fireEvent.click(screen.getByRole("tab", { name: /Explore/i }));
    fireEvent.click(screen.getByRole("button", { name: "Audio Lesson" }));

    await waitFor(() => expect(screen.getByTestId("playable-audio-lesson")).toBeInTheDocument());
    expect(screen.getByTestId("audio-cache-status")).toHaveTextContent("Cached for offline");

    // Adjust playback speed & seek to turn 2
    fireEvent.change(screen.getByLabelText("Playback speed"), { target: { value: "1.5" } });
    fireEvent.click(screen.getByLabelText("Next turn"));
    expect(screen.getByText("Turn 2/2")).toBeInTheDocument();

    // Switch to Explore -> Slides
    fireEvent.click(screen.getByRole("button", { name: "Slides" }));
    expect(screen.getByTestId("playable-slides-player")).toBeInTheDocument();
    expect(screen.getByText("Energy Currency")).toBeInTheDocument();

    // Navigate to slide 2 and jump to source citation
    fireEvent.click(screen.getByLabelText("Next slide"));
    expect(screen.getByText("Oxidative Phosphorylation")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Source citation 1"));
    expect(onJump).toHaveBeenCalledWith(
      "Mitochondria produce ATP",
      expect.objectContaining({ kind: "text" })
    );
  });
});
