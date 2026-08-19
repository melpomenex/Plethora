/**
 * Billing-safety tests for the audio-edition generation store (ai-billing-safety
 * #14): a paid cloud TTS provider must not start synthesis without consent.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAudioEditionGenerationStore } from "../audioEditionGenerationStore";
import { createAudioEdition } from "../../api/audioEditions";
import { useSettingsStore } from "../settingsStore";
import { clearPaidConsentDenials, setPaidConsentHandler } from "../../utils/aiBillingConsent";
import type { AudioEditionSection } from "../../types/audioEdition";

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

function section(id: string): AudioEditionSection {
  return {
    id,
    editionId: "ed-paid",
    sectionIndex: 0,
    title: "Chapter 1",
    characterCount: 100,
    audioMimeType: "audio/mp3",
    durationSec: 0,
    generationStatus: "queued",
    retryCount: 0,
    cacheKey: `k-${id}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as AudioEditionSection;
}

async function seedEdition(provider: string) {
  await createAudioEdition(
    {
      id: "ed-paid",
      sourceDocumentId: "doc-1",
      sourceRevisionHash: "hash-1",
      provider,
      model: "tts-1",
      voice: "alloy",
      totalDurationSec: 0,
      status: "draft",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    [section("sec-1")]
  );
}

function setPaidTtsConsent(enabled: boolean) {
  useSettingsStore.setState((s) => ({
    settings: {
      ...s.settings,
      tts: { ...s.settings.tts, paidTtsEnabled: enabled },
    },
  }));
}

describe("audio edition generation paid gate (ai-billing-safety #14)", () => {
  beforeEach(() => {
    useAudioEditionGenerationStore.setState({ jobs: {}, activeJobs: [], isGlobalPaused: false });
    mockEditions.clear();
    mockSections.clear();
    setPaidConsentHandler(null);
    clearPaidConsentDenials();
    setPaidTtsConsent(false);
  });

  it("does not start a job for a paid provider without consent", async () => {
    await seedEdition("openai");
    const consentHandler = vi.fn(async () => false);
    setPaidConsentHandler(consentHandler);

    await useAudioEditionGenerationStore.getState().startJob("ed-paid", {
      "sec-1": "Sample text",
    });

    expect(consentHandler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "tts", provider: "openai" })
    );
    expect(useAudioEditionGenerationStore.getState().getJob("ed-paid")).toBeUndefined();
  });

  it("starts the job when consent is granted by the handler", async () => {
    await seedEdition("openai");
    setPaidConsentHandler(vi.fn(async () => true));

    await useAudioEditionGenerationStore.getState().startJob("ed-paid", {
      "sec-1": "Sample text",
    });

    expect(useAudioEditionGenerationStore.getState().getJob("ed-paid")).toBeDefined();
  });

  it("starts the job when paid TTS consent is already persisted", async () => {
    await seedEdition("openai");
    setPaidTtsConsent(true);

    await useAudioEditionGenerationStore.getState().startJob("ed-paid", {
      "sec-1": "Sample text",
    });

    expect(useAudioEditionGenerationStore.getState().getJob("ed-paid")).toBeDefined();
  });

  it("starts a local/free provider job (pocket) without any consent", async () => {
    await seedEdition("pocket");

    await useAudioEditionGenerationStore.getState().startJob("ed-paid", {
      "sec-1": "Sample text",
    });

    expect(useAudioEditionGenerationStore.getState().getJob("ed-paid")).toBeDefined();
  });
});
