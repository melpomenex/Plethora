import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  useAudioEditionGenerationStore,
  applyPronunciationDictionary,
} from "../audioEditionGenerationStore";
import {
  computeSentenceAnchors,
  resolveAnchorAtTimestamp,
  expandSmartExtractBoundaries,
} from "../../utils/audioEditionAnchors";
import { estimateAudioEditionCost, formatAudioDuration } from "../../utils/audioEditionEstimation";
import { createAudioEdition, getAudioEdition, getAudioEditionSections } from "../../api/audioEditions";
import { registerScenarioSynthAdapter } from "../../api/tts/registry";

const mockEditions = new Map<string, any>();
const mockSections = new Map<string, any[]>();

vi.mock("../../lib/tauri", () => ({
  isTauri: () => false,
  invokeCommand: vi.fn(async (cmd: string, args: any) => {
    if (cmd === "create_audio_edition") {
      mockEditions.set(args.edition.id, { ...args.edition, sections: args.sections });
      mockSections.set(args.edition.id, [...args.sections]);
      return { ...args.edition, sections: args.sections };
    }
    if (cmd === "get_audio_edition") {
      const ed = mockEditions.get(args.id);
      if (!ed) return null;
      return { ...ed, sections: mockSections.get(args.id) || [] };
    }
    if (cmd === "get_audio_edition_sections") {
      return mockSections.get(args.editionId) || [];
    }
    if (cmd === "update_audio_edition_section_status") {
      const secs = mockSections.get(args.id) || [];
      const s = secs.find((x: any) => x.id === args.id);
      if (s) s.generationStatus = args.generationStatus;
      return;
    }
    if (cmd === "update_audio_edition_status") {
      const ed = mockEditions.get(args.id);
      if (ed) ed.status = args.status;
      return;
    }
    if (cmd === "save_audio_edition_anchors") {
      return;
    }
    return null;
  }),
}));

describe("Audio Edition Generation & Anchors", () => {
  beforeEach(() => {
    useAudioEditionGenerationStore.setState({
      jobs: {},
      activeJobs: [],
      isGlobalPaused: false,
    });
  });

  describe("Pronunciation Dictionary", () => {
    it("replaces defined phonetic words using word boundaries", () => {
      const text = "He lives in Episteme and studies epistemology in SQL.";
      const dictionary = {
        Episteme: "eh-PISS-tuh-mee",
        SQL: "sequel",
      };

      const result = applyPronunciationDictionary(text, dictionary);
      expect(result).toBe("He lives in eh-PISS-tuh-mee and studies epistemology in sequel.");
    });

    it("returns original text when dictionary is empty", () => {
      const text = "Original unmodified sentence.";
      expect(applyPronunciationDictionary(text)).toBe(text);
      expect(applyPronunciationDictionary(text, {})).toBe(text);
    });
  });

  describe("Source-to-Audio Anchor Computation", () => {
    it("computes sentence anchors proportional to character weights", () => {
      const text = "First sentence here. Second sentence is slightly longer! Third sentence.";
      const totalDurationSec = 30.0;
      const anchors = computeSentenceAnchors("sec-1", text, totalDurationSec, "100");

      expect(anchors.length).toBe(3);
      expect(anchors[0].audioStartSec).toBe(0);
      expect(anchors[0].textContent).toBe("First sentence here.");
      expect(anchors[2].audioEndSec).toBe(30.0);
      expect(anchors[2].textContent).toBe("Third sentence.");
    });

    it("resolves anchor at specific playback timestamp", () => {
      const anchors = [
        {
          id: "anc-1",
          sectionId: "sec-1",
          audioStartSec: 0.0,
          audioEndSec: 10.0,
          sourceStartAnchor: "0",
          sourceEndAnchor: "20",
          textContent: "Sentence 1",
        },
        {
          id: "anc-2",
          sectionId: "sec-1",
          audioStartSec: 10.0,
          audioEndSec: 25.0,
          sourceStartAnchor: "21",
          sourceEndAnchor: "50",
          textContent: "Sentence 2",
        },
      ];

      const resolved = resolveAnchorAtTimestamp(anchors, 15.0);
      expect(resolved?.id).toBe("anc-2");
      expect(resolved?.textContent).toBe("Sentence 2");
    });

    it("expands smart extract window to sentence boundaries", () => {
      const anchors = [
        {
          id: "anc-1",
          sectionId: "sec-1",
          audioStartSec: 0.0,
          audioEndSec: 10.0,
          sourceStartAnchor: "0",
          sourceEndAnchor: "20",
          textContent: "First thought.",
        },
        {
          id: "anc-2",
          sectionId: "sec-1",
          audioStartSec: 10.0,
          audioEndSec: 20.0,
          sourceStartAnchor: "21",
          sourceEndAnchor: "45",
          textContent: "Second crucial insight.",
        },
        {
          id: "anc-3",
          sectionId: "sec-1",
          audioStartSec: 20.0,
          audioEndSec: 30.0,
          sourceStartAnchor: "46",
          sourceEndAnchor: "70",
          textContent: "Third conclusion.",
        },
      ];

      // At timestamp 22, with lookback 15s (window: 7 to 22), should cover anc-1 (ends 10), anc-2 (10-20), anc-3 (20-30)
      const extract = expandSmartExtractBoundaries(anchors, 22.0, 15);
      expect(extract.matchedAnchors.length).toBeGreaterThanOrEqual(2);
      expect(extract.text).toContain("Second crucial insight.");
      expect(extract.text).toContain("Third conclusion.");
    });
  });

  describe("Cost and Duration Estimation", () => {
    it("estimates cost and duration for cloud providers", () => {
      const estimation = estimateAudioEditionCost({
        characterCount: 9000,
        provider: "openai",
        model: "tts-1",
        speed: 1.0,
      });

      expect(estimation.characterCount).toBe(9000);
      expect(estimation.wordCount).toBe(1800);
      // 9000 chars / 15 chars/sec = 600 seconds = 10 minutes
      expect(estimation.estimatedDurationSec).toBe(600);
      expect(estimation.isFreeTier).toBe(false);
      // 9000 / 1M * 15 = 0.135
      expect(estimation.estimatedCostUsd).toBeCloseTo(0.135, 3);
    });

    it("marks local/pocket provider as free tier", () => {
      const estimation = estimateAudioEditionCost({
        characterCount: 50000,
        provider: "pocket",
      });

      expect(estimation.isFreeTier).toBe(true);
      expect(estimation.estimatedCostUsd).toBe(0);
    });

    it("formats durations accurately", () => {
      expect(formatAudioDuration(45)).toBe("45 sec");
      expect(formatAudioDuration(300)).toBe("5 min");
      expect(formatAudioDuration(3690)).toBe("1 hr 1 min");
    });
  });

  async function waitForJobCompletion(editionId: string, timeoutMs = 2000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const job = useAudioEditionGenerationStore.getState().getJob(editionId);
      if (job && job.status !== "generating" && !useAudioEditionGenerationStore.getState().activeJobs.includes(editionId)) {
        return;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  describe("Generation Queue Store", () => {
  beforeEach(() => {
    registerScenarioSynthAdapter({
      id: "scenario-synth" as any,
      label: "Synthetic Test Provider",
      kind: "local",
      auth: { mode: "none" },
      capabilities: {
        supportsSpeed: true,
        supportsInstructions: false,
        supportsCloning: false,
        supportsCustomVoiceIds: false,
        supportsWordTimings: false,
        audioFormats: ["wav"],
        maxInputChars: 5000,
      },
      listModels: async () => [{ id: "test-model", name: "Test Model", vendor: "Test", supportedVoices: null, supportedParameters: [] }],
      listVoices: async () => [{ id: "test-voice", name: "Test Voice", provider: "scenario-synth" as any, modelId: "test-model" }],
      synthesize: vi.fn(async () => ({
        audioUrl: "blob:test-audio",
        durationSec: 12,
        audioData: new ArrayBuffer(100),
        rawOutput: {},
      })),
    });
  });

  it("initializes and tracks jobs", async () => {
    const edition = await createAudioEdition(
      {
        id: "ed-test-1",
        sourceDocumentId: "doc-1",
        sourceRevisionHash: "hash-1",
        provider: "pocket",
        model: "default",
        voice: "voice-1",
        totalDurationSec: 0,
        status: "draft",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      [
        {
          id: "sec-1",
          editionId: "ed-test-1",
          sectionIndex: 0,
          title: "Chapter 1",
          characterCount: 100,
          audioMimeType: "audio/mp3",
          durationSec: 0,
          generationStatus: "queued",
          retryCount: 0,
          cacheKey: "k1",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]
    );

    const fetchedEdition = await getAudioEdition("ed-test-1");
    expect(fetchedEdition).toBeDefined();

    const fetchedSections = await getAudioEditionSections("ed-test-1");
    expect(fetchedSections.length).toBe(1);

    await useAudioEditionGenerationStore.getState().startJob("ed-test-1", { "sec-1": "Sample text for chapter one" });

    const job = useAudioEditionGenerationStore.getState().getJob("ed-test-1");
    expect(job).toBeDefined();
    expect(job?.editionId).toBe("ed-test-1");
  });

  it("fails section when section content is empty and does not fall back to synthesizing title", async () => {
    await createAudioEdition(
      {
        id: "ed-empty-test",
        sourceDocumentId: "doc-empty",
        sourceRevisionHash: "hash-empty",
        provider: "scenario-synth",
        model: "test-model",
        voice: "test-voice",
        totalDurationSec: 0,
        status: "draft",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      [
        {
          id: "sec-empty-1",
          editionId: "ed-empty-test",
          sectionIndex: 0,
          title: "Empty Chapter",
          characterCount: 0,
          audioMimeType: "audio/mp3",
          durationSec: 0,
          generationStatus: "queued",
          retryCount: 0,
          cacheKey: "k-empty",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]
    );

    // Provide empty whitespace string in sectionTextMap
    await useAudioEditionGenerationStore.getState().startJob("ed-empty-test", {
      "sec-empty-1": "   \n  ",
    });

    await waitForJobCompletion("ed-empty-test");

    const job = useAudioEditionGenerationStore.getState().getJob("ed-empty-test");
    expect(job).toBeDefined();
    expect(job?.status).toBe("error");
    expect(job?.failedSections).toBe(1);
    expect(job?.completedSections).toBe(0);

    const sections = await getAudioEditionSections("ed-empty-test");
    expect(sections[0].generationStatus).toBe("failed");
    expect(sections[0].failureReason).toBe("Section content is empty");

    const edition = await getAudioEdition("ed-empty-test");
    expect(edition?.status).toBe("failed");
  });

  it("completes successfully and marks ready when all sections succeed", async () => {
    await createAudioEdition(
      {
        id: "ed-success-test",
        sourceDocumentId: "doc-success",
        sourceRevisionHash: "hash-success",
        provider: "scenario-synth",
        model: "test-model",
        voice: "test-voice",
        totalDurationSec: 0,
        status: "draft",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      [
        {
          id: "sec-success-1",
          editionId: "ed-success-test",
          sectionIndex: 0,
          title: "Success Chapter",
          characterCount: 50,
          audioMimeType: "audio/mp3",
          durationSec: 0,
          generationStatus: "queued",
          retryCount: 0,
          cacheKey: "k-success",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]
    );

    await useAudioEditionGenerationStore.getState().startJob("ed-success-test", {
      "sec-success-1": "Valid body text that generates audio.",
    });

    await waitForJobCompletion("ed-success-test");

    const job = useAudioEditionGenerationStore.getState().getJob("ed-success-test");
    expect(job?.status).toBe("completed");
    expect(job?.completedSections).toBe(1);
    expect(job?.failedSections).toBe(0);
    expect(job?.progressPercent).toBe(100);

    const sections = await getAudioEditionSections("ed-success-test");
    expect(sections[0].generationStatus).toBe("ready");
    expect(sections[0].durationSec).toBe(12);

    const edition = await getAudioEdition("ed-success-test");
    expect(edition?.status).toBe("ready");
  });

  it("reports failed sections and sets partial status when some sections fail", async () => {
    await createAudioEdition(
      {
        id: "ed-partial-test",
        sourceDocumentId: "doc-partial",
        sourceRevisionHash: "hash-partial",
        provider: "scenario-synth",
        model: "test-model",
        voice: "test-voice",
        totalDurationSec: 0,
        status: "draft",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      [
        {
          id: "sec-part-1",
          editionId: "ed-partial-test",
          sectionIndex: 0,
          title: "Good Chapter",
          characterCount: 50,
          audioMimeType: "audio/mp3",
          durationSec: 0,
          generationStatus: "queued",
          retryCount: 0,
          cacheKey: "k-p1",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: "sec-part-2",
          editionId: "ed-partial-test",
          sectionIndex: 1,
          title: "Bad Chapter",
          characterCount: 0,
          audioMimeType: "audio/mp3",
          durationSec: 0,
          generationStatus: "queued",
          retryCount: 0,
          cacheKey: "k-p2",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]
    );

    await useAudioEditionGenerationStore.getState().startJob("ed-partial-test", {
      "sec-part-1": "Valid body content here.",
      "sec-part-2": "", // empty!
    });

    await waitForJobCompletion("ed-partial-test");

    const job = useAudioEditionGenerationStore.getState().getJob("ed-partial-test");
    expect(job?.status).toBe("error");
    expect(job?.completedSections).toBe(1);
    expect(job?.failedSections).toBe(1);

    const sections = await getAudioEditionSections("ed-partial-test");
    expect(sections[0].generationStatus).toBe("ready");
    expect(sections[1].generationStatus).toBe("failed");
    expect(sections[1].failureReason).toBe("Section content is empty");

    const edition = await getAudioEdition("ed-partial-test");
    expect(edition?.status).toBe("generating"); // partially ready, remaining failed
  });
});
});
