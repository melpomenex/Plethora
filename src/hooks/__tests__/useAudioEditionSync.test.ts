import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAudioEditionSync } from "../useAudioEditionSync";
import type { AudioEdition, AudioEditionSection, AudioEditionAnchor } from "../../types/audioEdition";

const mockEdition: AudioEdition = {
  id: "ed-sync-1",
  sourceDocumentId: "doc-sync-1",
  sourceRevisionHash: "rev-1",
  provider: "pocket",
  model: "default",
  voice: "alba",
  totalDurationSec: 120,
  status: "ready",
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const mockSections: AudioEditionSection[] = [
  {
    id: "sec-sync-1",
    editionId: "ed-sync-1",
    sectionIndex: 0,
    title: "Chapter 1",
    characterCount: 500,
    audioMimeType: "audio/mp3",
    durationSec: 60,
    generationStatus: "ready",
    retryCount: 0,
    cacheKey: "c1",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: "sec-sync-2",
    editionId: "ed-sync-1",
    sectionIndex: 1,
    title: "Chapter 2",
    characterCount: 600,
    audioMimeType: "audio/mp3",
    durationSec: 60,
    generationStatus: "ready",
    retryCount: 0,
    cacheKey: "c2",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

const mockAnchors: AudioEditionAnchor[] = [
  {
    id: "anc-1",
    sectionId: "sec-sync-1",
    audioStartSec: 0,
    audioEndSec: 30,
    sourceStartAnchor: "0",
    sourceEndAnchor: "250",
    textContent: "First half of chapter 1.",
  },
  {
    id: "anc-2",
    sectionId: "sec-sync-1",
    audioStartSec: 30,
    audioEndSec: 60,
    sourceStartAnchor: "251",
    sourceEndAnchor: "500",
    textContent: "Second half of chapter 1.",
  },
];

vi.mock("../../api/audioEditions", () => ({
  getAudioEditionByDocument: vi.fn(async (docId: string) => {
    if (docId === "doc-sync-1") return mockEdition;
    return null;
  }),
  getAudioEditionSections: vi.fn(async (editionId: string) => {
    if (editionId === "ed-sync-1") return mockSections;
    return [];
  }),
  getAudioEditionAnchors: vi.fn(async (sectionId: string) => {
    if (sectionId === "sec-sync-1") return mockAnchors;
    return [];
  }),
}));

describe("useAudioEditionSync", () => {
  it("loads audio edition and sections for given document", async () => {
    const { result } = renderHook(() => useAudioEditionSync("doc-sync-1"));

    // Wait for async load
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.hasAudioEdition).toBe(true);
    expect(result.current.edition?.id).toBe("ed-sync-1");
    expect(result.current.sections.length).toBe(2);
  });

  it("resolves active anchor on playback position update", async () => {
    const { result } = renderHook(() => useAudioEditionSync("doc-sync-1"));

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.setPlaybackPosition(0, 45);
    });

    expect(result.current.activeAnchor?.id).toBe("anc-2");
    expect(result.current.confidence).toBe("high");
  });

  it("seeks audio to source document anchor", async () => {
    const { result } = renderHook(() => useAudioEditionSync("doc-sync-1"));

    await act(async () => {
      await Promise.resolve();
    });

    let seekRes: any;
    act(() => {
      seekRes = result.current.seekToSourceAnchor("300");
    });

    expect(seekRes).toBeDefined();
    expect(seekRes.sectionIndex).toBe(0);
    expect(seekRes.audioSec).toBe(30);
    expect(result.current.activeAnchor?.id).toBe("anc-2");
  });

  it("returns null when no audio edition is available for document", async () => {
    const { result } = renderHook(() => useAudioEditionSync("doc-unrelated"));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.hasAudioEdition).toBe(false);
    expect(result.current.edition).toBeNull();
  });
});
