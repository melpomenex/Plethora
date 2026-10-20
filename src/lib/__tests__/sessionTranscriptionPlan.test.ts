import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelProfile } from "../../api/transcription";
import {
  resolveSessionTranscriptionPlan,
} from "../transcriptionProvider";
import { resetCloudAiDisclosure } from "../privacy/cloudAiDisclosure";

const defaultSession = {
  id: "sess-100",
  origin: "recorded",
  assetId: "asset-100",
  transcriptRevision: 0,
};

const installedLocalProfiles: ModelProfile[] = [
  {
    id: "nemotron-3.5-asr-0.6b",
    name: "NVIDIA Nemotron 3.5 ASR 0.6B",
    installed: true,
    sizeBytes: 600_000_000,
    capabilities: {
      fileTranscription: true,
      streaming: false,
      pseudoStreaming: false,
      segmentTimestamps: true,
      wordTimestamps: true,
      diarization: false,
      languageDetection: true,
      customVocabulary: false,
      offline: true,
      supportedLanguages: "en",
    },
  } as unknown as ModelProfile,
];

const emptyProfiles: ModelProfile[] = [];

describe("resolveSessionTranscriptionPlan matrix", () => {
  beforeEach(() => {
    resetCloudAiDisclosure();
    vi.clearAllMocks();
  });

  // 1. AI-excluded policy
  it("rejects transcription on AI-excluded documents", async () => {
    const res = await resolveSessionTranscriptionPlan({
      session: defaultSession,
      documentPrivacy: { isLocalOnly: false, isAiExcluded: true },
      audioSettings: {
        provider: "local",
        language: "en",
        groq: { apiKey: "", model: "whisper-large-v3" },
      } as any,
      profiles: installedLocalProfiles,
      platform: "desktop",
    });

    expect(res.ok).toBe(false);
    if (!res.ok && "blockedReason" in res) {
      expect(res.blockedReason).toBe("policy-excluded");
      expect(res.reason).toBe("ai-excluded");
    }
  });

  // 2. Local-only document policy
  it("allows local execution on local-only documents when local model is ready", async () => {
    const res = await resolveSessionTranscriptionPlan({
      session: defaultSession,
      documentPrivacy: { isLocalOnly: true, isAiExcluded: false },
      audioSettings: {
        provider: "local",
        language: "en",
        groq: { apiKey: "", model: "whisper-large-v3" },
      } as any,
      profiles: installedLocalProfiles,
      platform: "desktop",
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.plan.executor).toBe("rust-local");
      expect(res.plan.isLocal).toBe(true);
      expect(res.plan.privacyCategory).toBe("local-only");
      expect(res.plan.provider).toBe("local");
    }
  });

  it("blocks cloud execution on local-only documents even when cloud key is configured", async () => {
    const res = await resolveSessionTranscriptionPlan({
      session: defaultSession,
      documentPrivacy: { isLocalOnly: true, isAiExcluded: false },
      audioSettings: {
        provider: "groq",
        automaticFallback: false,
        preferLocal: false,
        language: "en",
        groq: { apiKey: "gsk_test123", model: "whisper-large-v3" },
      } as any,
      profiles: emptyProfiles,
      platform: "desktop",
    });

    expect(res.ok).toBe(false);
    if (!res.ok && "blockedReason" in res) {
      expect(res.blockedReason).toBe("policy-excluded");
      expect(res.reason).toBe("cloud-forbidden-for-local-only");
    }
  });

  // 3. Android on-device execution
  it("assigns native-android executor on mobile when Android STT is ready", async () => {
    const res = await resolveSessionTranscriptionPlan({
      session: defaultSession,
      documentPrivacy: { isLocalOnly: false, isAiExcluded: false },
      audioSettings: {
        provider: "android-ondevice",
        language: "en",
        groq: { apiKey: "", model: "whisper-large-v3" },
      } as any,
      profiles: emptyProfiles,
      platform: "native-mobile",
      options: { androidSttReady: true },
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.plan.executor).toBe("native-android");
      expect(res.plan.isLocal).toBe(true);
      expect(res.plan.provider).toBe("android-ondevice");
    }
  });

  // 4. Apple Speech native execution
  it("assigns native-apple executor on mobile when Apple Speech is ready", async () => {
    const res = await resolveSessionTranscriptionPlan({
      session: defaultSession,
      documentPrivacy: { isLocalOnly: false, isAiExcluded: false },
      audioSettings: {
        provider: "apple",
        language: "en",
        groq: { apiKey: "", model: "whisper-large-v3" },
      } as any,
      profiles: emptyProfiles,
      platform: "native-mobile",
      options: { appleReady: true },
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.plan.executor).toBe("native-apple");
      expect(res.plan.isLocal).toBe(true);
      expect(res.plan.provider).toBe("apple");
    }
  });

  // 5. Offline enforcement
  it("blocks cloud execution when offline or network unavailable", async () => {
    const res = await resolveSessionTranscriptionPlan({
      session: defaultSession,
      documentPrivacy: { isLocalOnly: false, isAiExcluded: false },
      audioSettings: {
        provider: "groq",
        language: "en",
        groq: { apiKey: "gsk_test123", model: "whisper-large-v3" },
      } as any,
      profiles: emptyProfiles,
      platform: "desktop",
      options: { forceOffline: true },
    });

    expect(res.ok).toBe(false);
    if (!res.ok && "blockedReason" in res) {
      expect(res.blockedReason).toBe("offline-required");
    }
  });

  // 6. Cloud disclosure & missing presenter
  it("blocks remote cloud execution when disclosure presenter is missing and consent not stored", async () => {
    const res = await resolveSessionTranscriptionPlan({
      session: defaultSession,
      documentPrivacy: { isLocalOnly: false, isAiExcluded: false },
      audioSettings: {
        provider: "groq",
        language: "en",
        groq: { apiKey: "gsk_test123", model: "whisper-large-v3" },
      } as any,
      profiles: emptyProfiles,
      platform: "desktop",
      options: {
        disclosurePresenter: null, // Headless / missing presenter
        hasDurableConsent: false,
      },
    });

    expect(res.ok).toBe(false);
    if (!res.ok && "blockedReason" in res) {
      expect(res.blockedReason).toBe("consent-required");
      expect(res.reason).toBe("missing-presenter");
    }
  });

  it("blocks remote cloud execution when user declines disclosure", async () => {
    const presenter = vi.fn().mockResolvedValue(false);

    const res = await resolveSessionTranscriptionPlan({
      session: defaultSession,
      documentPrivacy: { isLocalOnly: false, isAiExcluded: false },
      audioSettings: {
        provider: "groq",
        language: "en",
        groq: { apiKey: "gsk_test123", model: "whisper-large-v3" },
      } as any,
      profiles: emptyProfiles,
      platform: "desktop",
      options: {
        disclosurePresenter: presenter,
      },
    });

    expect(presenter).toHaveBeenCalledOnce();
    expect(res.ok).toBe(false);
    if (!res.ok && "blockedReason" in res) {
      expect(res.blockedReason).toBe("consent-required");
      expect(res.reason).toBe("consent-declined");
    }
  });

  it("creates frozen plan and durable authorization when disclosure is accepted", async () => {
    const presenter = vi.fn().mockResolvedValue(true);

    const res = await resolveSessionTranscriptionPlan({
      session: defaultSession,
      documentPrivacy: { isLocalOnly: false, isAiExcluded: false },
      audioSettings: {
        provider: "groq",
        language: "en",
        groq: { apiKey: "gsk_test123", model: "whisper-large-v3" },
      } as any,
      profiles: emptyProfiles,
      platform: "desktop",
      options: {
        disclosurePresenter: presenter,
      },
    });

    expect(presenter).toHaveBeenCalledOnce();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.plan.executor).toBe("frontend-service");
      expect(res.plan.isLocal).toBe(false);
      expect(res.plan.privacyCategory).toBe("cloud-authorized");
      expect(res.authorization).toBeDefined();
      expect(res.authorization?.sessionId).toBe("sess-100");
      expect(res.authorization?.provider).toBe("groq");
      expect(res.authorization?.userConsented).toBe(true);
    }
  });

  // 7. Missing credentials
  it("reports missing API key when cloud provider has no credentials", async () => {
    const presenter = vi.fn().mockResolvedValue(true);

    const res = await resolveSessionTranscriptionPlan({
      session: defaultSession,
      documentPrivacy: { isLocalOnly: false, isAiExcluded: false },
      audioSettings: {
        provider: "groq",
        language: "en",
        groq: { apiKey: "", model: "whisper-large-v3" }, // Empty key
      } as any,
      profiles: emptyProfiles,
      platform: "desktop",
      options: {
        disclosurePresenter: presenter,
      },
    });

    expect(res.ok).toBe(false);
    if (!res.ok && "blockedReason" in res) {
      expect(res.blockedReason).toBe("provider-unavailable");
      expect(res.reason).toBe("missing-groq-key");
    }
  });
});
