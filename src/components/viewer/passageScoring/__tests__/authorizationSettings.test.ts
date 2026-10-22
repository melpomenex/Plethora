import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultSettings, useSettingsStore } from "../../../../stores/settingsStore";
import { useLLMProvidersStore } from "../../../../stores/llmProvidersStore";
import {
  PASSAGE_REMOTE_USAGE_STORAGE_KEY,
  consumeRemotePassageScoringUnit,
  getRemotePassageScoringUsage,
  grantRemotePassageScoring,
  remotePassageScoringTarget,
  resetRemoteAuthorizationPersistenceForTests,
  revokeRemotePassageScoring,
  syncRemoteAuthorizationFromSettings,
} from "../authorizationSettings";
import {
  getPassageRemoteScoringAuthorization,
  resetPassageScoringPolicyForTests,
} from "../policy";
import {
  PASSAGE_REMOTE_GRANT_MAX,
  normalizePassageRemoteScoringSetting,
} from "../../../../lib/ai/passageScoringConsent";

function resetStores(): void {
  localStorage.clear();
  sessionStorage.clear();
  useSettingsStore.setState({ settings: JSON.parse(JSON.stringify(defaultSettings)) });
  useLLMProvidersStore.setState({ providers: [] });
  resetPassageScoringPolicyForTests();
  resetRemoteAuthorizationPersistenceForTests();
}

function useCloudProvider(input: {
  provider: "openai" | "ollama";
  apiKey?: string;
  baseUrl?: string;
}): void {
  useLLMProvidersStore.setState({
    providers: [
      {
        id: "p1",
        provider: input.provider,
        name: input.provider,
        apiKey: input.apiKey ?? "",
        baseUrl: input.baseUrl,
        model: "test-model",
        enabled: true,
        temperature: 0.7,
        maxTokens: 1024,
      },
    ],
  });
}

describe("remote passage-scoring authorization", () => {
  beforeEach(resetStores);
  afterEach(resetStores);

  it("reports an off-device destination for a cloud provider", () => {
    useCloudProvider({ provider: "openai", apiKey: "sk-test" });
    const target = remotePassageScoringTarget();
    expect(target).toMatchObject({ providerId: "cloud-llm", offDevice: true });
  });

  it("treats a loopback Ollama endpoint as on-device (no grant needed)", () => {
    useCloudProvider({ provider: "ollama", baseUrl: "http://127.0.0.1:11434" });
    const target = remotePassageScoringTarget();
    expect(target).toMatchObject({ offDevice: false, locality: "loopback" });
    // Nothing to consent to: granting is a no-op, not a silent widening.
    expect(grantRemotePassageScoring({ maxClassifications: 10 })).toBeNull();
  });

  it("persists an explicit finite grant and shows the allowance", () => {
    useCloudProvider({ provider: "openai", apiKey: "sk-test" });

    const setting = grantRemotePassageScoring({ maxClassifications: 25 });
    expect(setting).not.toBeNull();
    expect(useSettingsStore.getState().settings.ai.remotePassageScoring).toMatchObject({
      providerId: "cloud-llm",
      sourceScope: "*",
      maxClassifications: 25,
    });
    expect(getPassageRemoteScoringAuthorization()?.remaining).toBe(25);
    expect(getRemotePassageScoringUsage()).toEqual({
      allowed: 25,
      used: 0,
      remaining: 25,
    });
  });

  it("never grants more than the local hourly envelope", () => {
    useCloudProvider({ provider: "openai", apiKey: "sk-test" });
    const setting = grantRemotePassageScoring({
      maxClassifications: PASSAGE_REMOTE_GRANT_MAX + 500,
    });
    expect(setting?.maxClassifications).toBe(PASSAGE_REMOTE_GRANT_MAX);
  });

  it("persists consumed units so a restart cannot refill the allowance", () => {
    useCloudProvider({ provider: "openai", apiKey: "sk-test" });
    grantRemotePassageScoring({ maxClassifications: 10 });

    expect(consumeRemotePassageScoringUnit()).toBe(true);
    expect(consumeRemotePassageScoringUnit()).toBe(true);
    expect(getRemotePassageScoringUsage()?.used).toBe(2);

    const persisted = JSON.parse(
      localStorage.getItem(PASSAGE_REMOTE_USAGE_STORAGE_KEY) || "{}"
    );
    expect(persisted.used).toBe(2);

    // Simulate a restart: drop runtime state, rehydrate from Settings.
    resetPassageScoringPolicyForTests();
    syncRemoteAuthorizationFromSettings();
    expect(getPassageRemoteScoringAuthorization()?.used).toBe(2);
    expect(getPassageRemoteScoringAuthorization()?.remaining).toBe(8);
  });

  it("stops authorizing remote work after revocation", () => {
    useCloudProvider({ provider: "openai", apiKey: "sk-test" });
    grantRemotePassageScoring({ maxClassifications: 10 });
    revokeRemotePassageScoring();

    expect(useSettingsStore.getState().settings.ai.remotePassageScoring).toBeNull();
    expect(getPassageRemoteScoringAuthorization()).toBeNull();
    expect(localStorage.getItem(PASSAGE_REMOTE_USAGE_STORAGE_KEY)).toBeNull();
  });

  it("drops a corrupt persisted grant instead of widening it", () => {
    expect(normalizePassageRemoteScoringSetting({})).toBeNull();
    expect(
      normalizePassageRemoteScoringSetting({
        id: "g",
        providerId: "cloud-llm",
        locality: "remote",
        sourceScope: "*",
        maxClassifications: -5,
        grantedAt: 1,
      })
    ).toBeNull();
    expect(
      normalizePassageRemoteScoringSetting({
        id: "g",
        providerId: "cloud-llm",
        locality: "not-a-locality",
        sourceScope: "*",
        maxClassifications: 10,
        grantedAt: 1,
      })
    ).toBeNull();

    const clamped = normalizePassageRemoteScoringSetting({
      id: "g",
      providerId: "cloud-llm",
      locality: "remote",
      sourceScope: "*",
      maxClassifications: 500,
      grantedAt: 1,
    });
    expect(clamped?.maxClassifications).toBe(PASSAGE_REMOTE_GRANT_MAX);
  });
});
