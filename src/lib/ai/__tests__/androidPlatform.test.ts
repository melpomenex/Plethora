import { describe, expect, it } from "vitest";
import { askLibrary } from "../tasks/definitions/libraryTask";
import { FakeAIProvider } from "../__fixtures__/FakeAIProvider";
import { FakeSemanticRetriever } from "../__fixtures__/FakePlatformProviders";
import { RAG_NAMESPACE_HELP, RAG_NAMESPACE_LIBRARY } from "../capabilities/search";
import { classifyDeviceAiTier, mayOfferGenerativeAiPack } from "../deviceTiers";
import { EMBEDDING_GEMMA_LICENSE, mayShipGenerativePack } from "../modelLicense";
import { assertMlKitSpeechPcm, isMlKitSpeechPcm } from "../android/pcm";
import { requirePersistedSpeechSource } from "../android/speechProvider";
import { DEFAULT_ENTITY_EXTRACTION_ENABLED } from "../android/languageIdProvider";
import { isAppSearchDerivedIndexEnabled } from "../android/appSearchRetriever";
import { useSettingsStore } from "../../../stores/settingsStore";
import type { RetrievalResult } from "../../../api/ai-learning";

const hit: RetrievalResult = {
  chunkId: "c1",
  documentId: "d1",
  documentTitle: "Notes",
  sourceType: "document",
  ordinal: 0,
  text: "Photosynthesis converts light to chemical energy.",
  headingPath: [],
  location: {
    sourceType: "text",
    documentId: "d1",
    ordinal: 0,
    startOffset: 0,
    endOffset: 48,
  },
  contentHash: "hash-c1",
  tokenCount: 12,
  score: 0.9,
  mode: "semantic",
};

describe("askLibrary composition", () => {
  it("returns retrieval-only hits when the generator is none (no silent cloud)", async () => {
    const retriever = new FakeSemanticRetriever([hit]);
    const result = await askLibrary({
      query: "photosynthesis",
      retriever,
      composition: {
        retrieverId: "ai_learning",
        generatorKind: "none",
        namespace: RAG_NAMESPACE_LIBRARY,
      },
    });
    expect(result.retrievalOnly).toBe(true);
    expect(result.sources.map((s) => s.chunkId)).toEqual(["c1"]);
    expect(result.run.fallbackPath).toBe("none");
  });

  it("refuses to mix the help namespace with the default library retrieve", async () => {
    await expect(
      askLibrary({
        query: "how do I import",
        composition: {
          retrieverId: "document-only",
          generatorKind: "none",
          namespace: RAG_NAMESPACE_HELP,
        },
      })
    ).rejects.toMatchObject({ category: "IndexUnavailable" });
  });

  it("does not invoke FakeAIProvider when generatorKind is none", async () => {
    const provider = new FakeAIProvider({
      responses: [{ requestId: "x", text: "should not run" }],
    });
    const result = await askLibrary({
      query: "q",
      provider,
      retriever: new FakeSemanticRetriever([hit]),
      composition: {
        retrieverId: "ai_learning",
        generatorKind: "none",
        namespace: RAG_NAMESPACE_LIBRARY,
      },
    });
    expect(provider.callCount).toBe(0);
    expect(result.retrievalOnly).toBe(true);
  });
});

describe("device tiers and licenses", () => {
  it("never offers a generative pack on low RAM", () => {
    expect(classifyDeviceAiTier({ totalRamMb: 2048 })).toBe("none");
    expect(mayOfferGenerativeAiPack("embed")).toBe(false);
    expect(mayOfferGenerativeAiPack("gen")).toBe(true);
    expect(mayShipGenerativePack(EMBEDDING_GEMMA_LICENSE)).toBe(true);
    expect(mayShipGenerativePack({ ...EMBEDDING_GEMMA_LICENSE, license: "unlicensed" })).toBe(
      false
    );
  });
});

describe("speech and search policy", () => {
  it("requires a persisted audio URI before STT", () => {
    expect(() => requirePersistedSpeechSource("  ")).toThrow(/persisted/);
    expect(requirePersistedSpeechSource("file://rec.pcm")).toBe("file://rec.pcm");
  });

  it("accepts only 16 kHz mono PCM16LE", () => {
    expect(isMlKitSpeechPcm({ sampleRateHz: 16000, channels: 1, encoding: "pcm16le" })).toBe(true);
    expect(() =>
      assertMlKitSpeechPcm({ sampleRateHz: 44100, channels: 2, encoding: "pcm16le" })
    ).toThrow(/codec_unsupported/);
  });

  it("keeps AppSearch and entity extraction off by default", () => {
    expect(useSettingsStore.getState().settings.features.androidAppSearchIndex).toBe(false);
    expect(isAppSearchDerivedIndexEnabled()).toBe(false);
    expect(DEFAULT_ENTITY_EXTRACTION_ENABLED).toBe(false);
  });
});
