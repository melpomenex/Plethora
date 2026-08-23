import { describe, expect, it } from "vitest";
import { PLATFORM_CAPABILITY_IDS, unavailableDescriptor } from "../capabilities/types";
import {
  FakeLanguageIdProvider,
  FakeSemanticRetriever,
  FakeSpeechProvider,
  FakeVisionScanProvider,
  unavailableSpeechProvider,
} from "../__fixtures__/FakePlatformProviders";
import { onDeviceRunLabel } from "../privacyIndicator";
import { DEFAULT_HELP_RAG, DEFAULT_LIBRARY_RAG, assertSeparateRagNamespaces } from "../ragComposition";
import { RAG_NAMESPACE_HELP, RAG_NAMESPACE_LIBRARY } from "../capabilities/search";

describe("platform capability surface", () => {
  it("lists the five platform-ML capability ids", () => {
    expect([...PLATFORM_CAPABILITY_IDS]).toEqual([
      "speech.transcribe",
      "vision.scan",
      "language.identify",
      "search.semantic",
      "translate.sentence",
    ]);
  });

  it("fakes implement the provider contracts without native calls", async () => {
    const speech = new FakeSpeechProvider({
      segments: [{ id: "s1", text: "hello" }],
    });
    const vision = new FakeVisionScanProvider({
      pages: [{ imageAssetId: "img-1", width: 1, height: 1 }],
    });
    const language = new FakeLanguageIdProvider("de");
    const retriever = new FakeSemanticRetriever([]);

    expect((await speech.getCapability()).id).toBe("speech.transcribe");
    expect((await speech.transcribeAudio({ sourceUri: "file://a.pcm" })).segments[0]?.text).toBe(
      "hello"
    );
    expect((await vision.scanDocument()).pages[0]?.imageAssetId).toBe("img-1");
    expect((await language.identifyLanguage("x")).language).toBe("de");
    expect(await retriever.retrieve({ query: "q", namespace: RAG_NAMESPACE_LIBRARY })).toEqual([]);
    expect((await unavailableSpeechProvider().getCapability()).available).toBe(false);
    expect(unavailableDescriptor("vision.scan").reason).toBe("platform_unsupported");
  });
});

describe("privacy indicator", () => {
  it("does not claim on-device after a cloud fallback", () => {
    expect(onDeviceRunLabel("ondevice", "cloud-fallback")).toBeNull();
    expect(onDeviceRunLabel("cloud", "none")).toBeNull();
    expect(onDeviceRunLabel("ondevice", "none")).toBe("On-device");
    expect(onDeviceRunLabel("retrieval-only", "none")).toBe("On-device");
  });
});

describe("RAG namespaces", () => {
  it("keeps help and library corpora distinct", () => {
    assertSeparateRagNamespaces();
    expect(DEFAULT_HELP_RAG.namespace).toBe(RAG_NAMESPACE_HELP);
    expect(DEFAULT_LIBRARY_RAG.namespace).toBe(RAG_NAMESPACE_LIBRARY);
    expect(DEFAULT_HELP_RAG.namespace).not.toBe(DEFAULT_LIBRARY_RAG.namespace);
  });
});
