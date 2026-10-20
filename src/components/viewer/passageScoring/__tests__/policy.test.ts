import { afterEach, describe, expect, it } from "vitest";
import { FakeAIProvider } from "../../../../lib/ai/__fixtures__/FakeAIProvider";
import {
  PASSAGE_CLASSIFIER_VERSION,
  consumePassageRemoteAuthorization,
  getObservedServingRevision,
  getPassageRemoteScoringAuthorization,
  grantPassageRemoteScoringAuthorization,
  recordObservedServingRevision,
  resetPassageScoringPolicyForTests,
  resolvePassageScoringPolicy,
  subscribePassageScoringAuthorization,
  revokePassageRemoteScoringAuthorization,
} from "../policy";

afterEach(() => resetPassageScoringPolicyForTests());

describe("classifier policy revision", () => {
  it("is stable, content-free and changes when the prompt/schema source changes", () => {
    expect(PASSAGE_CLASSIFIER_VERSION).toMatch(/^passage-classifier-v1:[0-9a-f]{24}$/);
    expect(PASSAGE_CLASSIFIER_VERSION).toBe(PASSAGE_CLASSIFIER_VERSION);
  });
});

describe("scoped remote authorization", () => {
  it("defaults to no grant and rejects unbounded/invalid grants", () => {
    expect(getPassageRemoteScoringAuthorization()).toBeNull();
    expect(
      grantPassageRemoteScoringAuthorization({
        id: "g1",
        providerId: "cloud-llm",
        locality: "remote",
        sourceScope: "doc-1",
        maxClassifications: 0,
        grantedAt: 1,
      })
    ).toBeNull();
    expect(
      grantPassageRemoteScoringAuthorization({
        id: "g1",
        providerId: "cloud-llm",
        locality: "remote",
        sourceScope: "",
        maxClassifications: 5,
        grantedAt: 1,
      })
    ).toBeNull();
    expect(
      grantPassageRemoteScoringAuthorization({
        id: "g1",
        providerId: "cloud-llm",
        locality: "remote",
        sourceScope: "doc-1",
        maxClassifications: 61,
        grantedAt: 1,
      })
    ).toBeNull();
  });

  it("consumes only matching provider/locality/scope and stops at the finite budget", () => {
    const grant = grantPassageRemoteScoringAuthorization({
      id: "g1",
      providerId: "cloud-llm",
      locality: "remote",
      sourceScope: "doc-1",
      maxClassifications: 2,
      grantedAt: 1,
    });
    expect(grant).not.toBeNull();
    expect(consumePassageRemoteAuthorization("other", "remote", "doc-1")).toBe(false);
    expect(consumePassageRemoteAuthorization("cloud-llm", "lan", "doc-1")).toBe(false);
    expect(consumePassageRemoteAuthorization("cloud-llm", "remote", "doc-2")).toBe(false);
    expect(consumePassageRemoteAuthorization("cloud-llm", "remote", "doc-1")).toBe(true);
    expect(consumePassageRemoteAuthorization("cloud-llm", "remote", "doc-1")).toBe(true);
    expect(consumePassageRemoteAuthorization("cloud-llm", "remote", "doc-1")).toBe(false);
    expect(getPassageRemoteScoringAuthorization()?.remaining).toBe(0);
    revokePassageRemoteScoringAuthorization("g1");
    expect(getPassageRemoteScoringAuthorization()).toBeNull();
  });

  it("notifies active owners on grant and revocation", () => {
    const changes: string[] = [];
    const unsubscribe = subscribePassageScoringAuthorization(() => changes.push("change"));
    grantPassageRemoteScoringAuthorization({
      id: "g3",
      providerId: "cloud-llm",
      locality: "remote",
      sourceScope: "doc-1",
      maxClassifications: 1,
      grantedAt: 1,
    });
    revokePassageRemoteScoringAuthorization("g3");
    unsubscribe();
    revokePassageRemoteScoringAuthorization();
    expect(changes).toHaveLength(2);
  });

  it("supports a wildcard source scope without widening the provider/locality", () => {
    grantPassageRemoteScoringAuthorization({
      id: "g2",
      providerId: "cloud-llm",
      locality: "remote",
      sourceScope: "*",
      maxClassifications: 1,
      grantedAt: 1,
    });
    expect(consumePassageRemoteAuthorization("cloud-llm", "remote", "rss:item-1")).toBe(true);
    expect(consumePassageRemoteAuthorization("cloud-llm", "remote", "doc-1")).toBe(false);
  });
});

describe("serving revision observation", () => {
  it("uses the actual serving model for subsequent lookups", () => {
    expect(getObservedServingRevision("cloud-llm", "openai:gpt-4o-mini")).toBe(
      "openai:gpt-4o-mini"
    );
    recordObservedServingRevision("cloud-llm", "openai:gpt-4o-mini", "gpt-4o-mini-2026-01-01");
    expect(getObservedServingRevision("cloud-llm", "openai:gpt-4o-mini")).toBe(
      "gpt-4o-mini-2026-01-01"
    );
  });
});

describe("local policy preflight", () => {
  it("resolves a native provider without any remote authorization", async () => {
    const provider = new FakeAIProvider({ id: "fake-ondevice", kind: "ondevice" });
    const resolution = await resolvePassageScoringPolicy({ providers: [provider], sourceScope: "doc-1" });
    expect(resolution.status).toBe("ready");
    if (resolution.status !== "ready") return;
    expect(resolution.policy.remote).toBe(false);
    expect(resolution.policy.authorized).toBe(true);
    expect(resolution.policy.provider).toBe(provider);
    expect(resolution.policy.servingRevision).toBe("fake-ondevice\u0000fake-ondevice");
    expect(resolution.policy.classifierVersion).toBe(PASSAGE_CLASSIFIER_VERSION);
  });

  it("reports unavailable when no provider can serve the classifier", async () => {
    const resolution = await resolvePassageScoringPolicy({ providers: [] });
    expect(resolution.status).toBe("unavailable");
    if (resolution.status === "unavailable") {
      expect(resolution.reasonKey).toContain("unavailableModel");
    }
  });
});
