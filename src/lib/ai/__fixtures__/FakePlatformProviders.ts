import type { RetrievalResult } from "../../../api/ai-learning";
import type { LanguageIdProvider } from "../capabilities/language";
import type { SemanticRetriever, SemanticRetrieveRequest } from "../capabilities/search";
import type { SpeechProvider, Transcript, TranscribeAudioRequest } from "../capabilities/speech";
import type { ScanDocumentRequest, ScanImport, VisionScanProvider } from "../capabilities/vision";
import type { PlatformCapabilityDescriptor } from "../capabilities/types";
import { unavailableDescriptor } from "../capabilities/types";
import type { TranslationProvider } from "../../languageTranslation/provider";

function ready(id: PlatformCapabilityDescriptor["id"]): PlatformCapabilityDescriptor {
  return {
    id,
    available: true,
    ready: true,
    requiresDownload: false,
    onDevice: true,
    networkRequired: false,
    foregroundOnly: id === "speech.transcribe" || id === "vision.scan",
    supportsStreaming: id === "speech.transcribe",
    supportsImages: id === "vision.scan",
    supportsStructuredOutput: false,
    supportedLanguages: ["en"],
    privacy: "on-device",
  };
}

export class FakeSpeechProvider implements SpeechProvider {
  readonly id = "fake-speech";
  constructor(private readonly transcript: Transcript) {}
  async getCapability() {
    return ready("speech.transcribe");
  }
  async transcribeAudio(_req: TranscribeAudioRequest): Promise<Transcript> {
    return this.transcript;
  }
}

export class FakeVisionScanProvider implements VisionScanProvider {
  readonly id = "fake-vision";
  constructor(private readonly result: ScanImport) {}
  async getCapability() {
    return ready("vision.scan");
  }
  async scanDocument(_req?: ScanDocumentRequest): Promise<ScanImport> {
    return this.result;
  }
}

export class FakeLanguageIdProvider implements LanguageIdProvider {
  readonly id = "fake-language-id";
  constructor(private readonly language = "en") {}
  async getCapability() {
    return ready("language.identify");
  }
  async identifyLanguage(_text: string) {
    return { language: this.language, confidence: 1 };
  }
}

export class FakeSemanticRetriever implements SemanticRetriever {
  readonly id = "ai_learning" as const;
  constructor(private readonly hits: RetrievalResult[] = []) {}
  async getCapability() {
    return ready("search.semantic");
  }
  async retrieve(_req: SemanticRetrieveRequest): Promise<RetrievalResult[]> {
    return this.hits;
  }
}

export function unavailableSpeechProvider(): SpeechProvider {
  return {
    id: "unavailable-speech",
    getCapability: async () => unavailableDescriptor("speech.transcribe"),
    transcribeAudio: async () => {
      throw new Error("speech unavailable");
    },
  };
}

/** Deterministic local translation adapter for tests. */
export function fakeLocalTranslationProvider(): TranslationProvider {
  return {
    id: "fake-mlkit-translate",
    kind: "local",
    version: "test",
    capabilities: {
      sentenceTranslation: true,
      supportedLanguagePairs: ["*"],
      offlineAvailable: true,
      sendsTextOffDevice: false,
      requiresCredentials: false,
      configured: true,
      supportsCancellation: true,
      privacyDisclosure: "On-device test adapter.",
    },
    translate: async (request) => ({ translatedText: `[${request.targetLanguage}] ${request.text}` }),
  };
}
