import { describe, expect, it } from "vitest";
import {
  AI_ERROR_CATEGORIES,
  AIError,
  ON_DEVICE_CODE_TO_CATEGORY,
  aiErrorFromCloud,
  aiErrorFromOnDevice,
  isAIError,
  isCancelledError,
  toAIError,
} from "../errors";
import { OnDeviceAiError, ON_DEVICE_AI_ERROR_CODES } from "../onDeviceAI";

describe("taxonomy", () => {
  it("contains the design-D6 categories plus Apple routing extensions", () => {
    expect([...AI_ERROR_CATEGORIES]).toEqual([
      "ModelUnavailable",
      "ModelDownloading",
      "UnsupportedDevice",
      "CapabilityUnavailable",
      "InputTooLarge",
      "GenerationFailed",
      "InvalidStructuredOutput",
      "SafetyBlocked",
      "EmbeddingUnavailable",
      "IndexUnavailable",
      "IndexBuilding",
      "VisionUnavailable",
      "OCRFailed",
      "ProviderOffline",
      "Cancelled",
      "PermissionDenied",
      "FeatureDisabled",
      "UnsupportedLanguage",
    ]);
  });

  it("maps every OnDeviceAiErrorCode onto a category", () => {
    for (const code of ON_DEVICE_AI_ERROR_CODES) {
      expect(ON_DEVICE_CODE_TO_CATEGORY[code]).toBeTruthy();
    }
  });
});

describe("aiErrorFromOnDevice", () => {
  it("maps each bridge code to its category and preserves the code", () => {
    expect(
      aiErrorFromOnDevice(new OnDeviceAiError("platform_unsupported", "no bridge")).category
    ).toBe("UnsupportedDevice");
    expect(
      aiErrorFromOnDevice(new OnDeviceAiError("device_unsupported", "no npu")).category
    ).toBe("UnsupportedDevice");
    expect(
      aiErrorFromOnDevice(new OnDeviceAiError("model_downloadable", "get nano")).category
    ).toBe("ModelDownloading");
    expect(
      aiErrorFromOnDevice(new OnDeviceAiError("model_downloading", "50%")).category
    ).toBe("ModelDownloading");
    expect(
      aiErrorFromOnDevice(new OnDeviceAiError("model_unavailable", "gone")).category
    ).toBe("ModelUnavailable");
    expect(
      aiErrorFromOnDevice(new OnDeviceAiError("inference_failed", "boom")).category
    ).toBe("GenerationFailed");
    expect(
      aiErrorFromOnDevice(new OnDeviceAiError("empty_output", "")).category
    ).toBe("GenerationFailed");
    expect(
      aiErrorFromOnDevice(new OnDeviceAiError("invalid_argument", "empty text")).category
    ).toBe("InputTooLarge");
    expect(aiErrorFromOnDevice(new OnDeviceAiError("invalid_image", "bad mime")).category).toBe(
      "VisionUnavailable"
    );
    expect(aiErrorFromOnDevice(new OnDeviceAiError("image_too_large", "6MB")).category).toBe(
      "InputTooLarge"
    );
    expect(
      aiErrorFromOnDevice(new OnDeviceAiError("feature_not_compiled", "no schema")).category
    ).toBe("CapabilityUnavailable");
    expect(
      aiErrorFromOnDevice(new OnDeviceAiError("feature_unavailable", "no summarize")).category
    ).toBe("CapabilityUnavailable");
    expect(
      aiErrorFromOnDevice(new OnDeviceAiError("context_too_large", "4k")).category
    ).toBe("InputTooLarge");
    expect(
      aiErrorFromOnDevice(new OnDeviceAiError("incomplete_output", "cut")).category
    ).toBe("GenerationFailed");
    expect(aiErrorFromOnDevice(new OnDeviceAiError("parse_failed", "no cards")).category).toBe(
      "InvalidStructuredOutput"
    );
    expect(aiErrorFromOnDevice(new OnDeviceAiError("cancelled", "user")).category).toBe("Cancelled");
  });

  it("keeps the original code so legacy code-based branching still works", () => {
    const err = aiErrorFromOnDevice(new OnDeviceAiError("cancelled", "user cancelled"));
    expect(err.code).toBe("cancelled");
    expect(isAIError(err)).toBe(true);
    expect(err.name).toBe("AIError");
  });

  it("recovers codes from flattened bridge message strings", () => {
    const err = aiErrorFromOnDevice(new Error('{"code":"model_downloading","message":"33%"}'));
    expect(err.category).toBe("ModelDownloading");
    expect(err.code).toBe("model_downloading");
  });

  it("defaults unknown errors to GenerationFailed with inference_failed code", () => {
    const err = aiErrorFromOnDevice(new Error("something odd"));
    expect(err.category).toBe("GenerationFailed");
    expect(err.code).toBe("inference_failed");
  });

  it("passes AIError through unchanged", () => {
    const original = new AIError("IndexBuilding", "busy");
    expect(aiErrorFromOnDevice(original)).toBe(original);
  });

  it("carries provider/task context", () => {
    const err = aiErrorFromOnDevice(new OnDeviceAiError("model_unavailable", "gone"), {
      providerId: "ondevice-gemini-nano",
      taskId: "passage-qa",
    });
    expect(err.providerId).toBe("ondevice-gemini-nano");
    expect(err.taskId).toBe("passage-qa");
  });
});

describe("aiErrorFromCloud", () => {
  it("classifies network and auth failures as ProviderOffline", () => {
    expect(aiErrorFromCloud(new Error("Failed to fetch")).category).toBe("ProviderOffline");
    expect(aiErrorFromCloud(new Error("connect ECONNREFUSED 127.0.0.1:11434")).category).toBe(
      "ProviderOffline"
    );
    expect(aiErrorFromCloud(new Error("401 Unauthorized: invalid api key")).category).toBe(
      "ProviderOffline"
    );
    expect(aiErrorFromCloud(new Error("Request timed out")).category).toBe("ProviderOffline");
  });

  it("classifies safety rejections as SafetyBlocked", () => {
    expect(aiErrorFromCloud(new Error("request blocked by content policy")).category).toBe(
      "SafetyBlocked"
    );
    expect(aiErrorFromCloud(new Error("flagged by the content filter")).category).toBe(
      "SafetyBlocked"
    );
  });

  it("classifies context overflow as InputTooLarge", () => {
    expect(
      aiErrorFromCloud(new Error("This model maximum context length is 8192")).category
    ).toBe("InputTooLarge");
  });

  it("classifies cancellation as Cancelled", () => {
    expect(aiErrorFromCloud(new Error("stream cancelled by client")).category).toBe("Cancelled");
  });

  it("defaults everything else to GenerationFailed", () => {
    expect(aiErrorFromCloud(new Error("weird upstream 500")).category).toBe("GenerationFailed");
    expect(aiErrorFromCloud(new Error("weird upstream 500")).code).toBe("generation_failed");
  });
});

describe("toAIError", () => {
  it("is identity for AIError", () => {
    const original = new AIError("Cancelled", "stop");
    expect(toAIError(original)).toBe(original);
  });

  it("routes OnDeviceAiError through the bridge table", () => {
    expect(toAIError(new OnDeviceAiError("parse_failed", "junk")).category).toBe(
      "InvalidStructuredOutput"
    );
  });

  it("routes generic errors through the cloud heuristics", () => {
    expect(toAIError(new Error("offline")).category).toBe("ProviderOffline");
  });

  it("routes errors whose message contains a bridge code through the bridge table", () => {
    expect(toAIError(new Error("bridge said feature_unavailable")).category).toBe(
      "CapabilityUnavailable"
    );
  });
});

describe("isCancelledError", () => {
  it("recognizes AIError Cancelled", () => {
    expect(isCancelledError(new AIError("Cancelled", "user cancelled", { code: "cancelled" }))).toBe(
      true
    );
    expect(isCancelledError(new AIError("GenerationFailed", "boom"))).toBe(false);
  });

  it("recognizes OnDeviceAiError cancelled", () => {
    expect(isCancelledError(new OnDeviceAiError("cancelled", "aborted"))).toBe(true);
    expect(isCancelledError(new OnDeviceAiError("inference_failed", "boom"))).toBe(false);
  });

  it("recognizes DOM AbortError", () => {
    expect(isCancelledError(new DOMException("The operation was aborted.", "AbortError"))).toBe(
      true
    );
  });
});
