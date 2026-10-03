import { describe, expect, it } from "vitest";
import {
  CLEF_MODELS,
  CLEF_PROVIDER_ID,
  DECISION_MODEL_OPTIONS,
  DECISION_SPINE_ID,
  JEV_BASE_URL,
  JEV_PROVIDER_ID,
  LAYA_DEFAULT_BASE_URL,
  LAYA_PROVIDER_ID,
  NO_DECISION_MODEL_ID,
  OPENAI_DECISIONS_BASE_URL,
  OPENAI_DECISIONS_PROVIDER_ID,
  OPENROUTER_DECISION_MODELS,
  OPENROUTER_DECISIONS_PROVIDER_ID,
  baseUrlFor,
  coerceDecisionModelId,
  getDecisionModelOption,
  isClefModel,
  isDecisionModelReady,
  isOpenRouterDecisionModel,
  isRemoteDecisionModel,
  modelFor,
  privacyOf,
  requiresRemoteOptIn,
  setupGaps,
} from "./decisionModelOptions";
import { LOCAL_DECISION_ENGINE_PROVIDER_ID } from "../ai/providers/localModelProvider";

const ready = { allowRemote: true };

describe("decision model options", () => {
  it("offers the PRD's backends, because they are all real", () => {
    // Correcting an earlier mistake: Jev, Laya and Clef are real deployments of
    // the System One protocol. This test exists to keep them from being removed
    // again on the assumption they were placeholders.
    const ids = DECISION_MODEL_OPTIONS.map((option) => option.id);
    expect(ids).toContain(JEV_PROVIDER_ID);
    expect(ids).toContain(LAYA_PROVIDER_ID);
    expect(ids).toContain(CLEF_PROVIDER_ID);
    expect(ids).toContain(OPENROUTER_DECISIONS_PROVIDER_ID);
    expect(ids).toContain(OPENAI_DECISIONS_PROVIDER_ID);
  });

  it("starts with the two routes that work with no configuration at all", () => {
    const ids = DECISION_MODEL_OPTIONS.map((option) => option.id);
    expect(ids[0]).toBe(NO_DECISION_MODEL_ID);
    expect(ids[1]).toBe(DECISION_SPINE_ID);
    for (const option of DECISION_MODEL_OPTIONS.slice(0, 2)) {
      expect(option.setup).toBe("none");
    }
  });

  it("declares what each deployment needs from the user", () => {
    expect(getDecisionModelOption(JEV_PROVIDER_ID)?.setup).toBe("api-key");
    expect(getDecisionModelOption(CLEF_PROVIDER_ID)?.setup).toBe("cloudflare-credentials");
    expect(getDecisionModelOption(OPENROUTER_DECISIONS_PROVIDER_ID)?.setup).toBe("openrouter-key");
    expect(getDecisionModelOption(OPENAI_DECISIONS_PROVIDER_ID)?.setup).toBe("openai-key");
    expect(getDecisionModelOption(LAYA_PROVIDER_ID)?.setup).toBe("endpoint");
  });

  it("labels the privacy of every option, because it is not inferable", () => {
    for (const option of DECISION_MODEL_OPTIONS) {
      expect(["on-device", "local", "remote"]).toContain(option.privacy);
    }
    // Laya is the one that can run with nothing leaving the machine.
    expect(privacyOf(LAYA_PROVIDER_ID)).toBe("on-device");
    expect(privacyOf(JEV_PROVIDER_ID)).toBe("remote");
    expect(privacyOf(CLEF_PROVIDER_ID)).toBe("remote");
    expect(privacyOf(OPENROUTER_DECISIONS_PROVIDER_ID)).toBe("remote");
    expect(privacyOf(OPENAI_DECISIONS_PROVIDER_ID)).toBe("remote");
    expect(privacyOf(LOCAL_DECISION_ENGINE_PROVIDER_ID)).toBe("local");
  });

  it("gives every vendor option a documentation link", () => {
    // A user choosing a third-party model deserves the vendor's own terms, not
    // a paraphrase of them.
    for (const id of [
      JEV_PROVIDER_ID,
      CLEF_PROVIDER_ID,
      LAYA_PROVIDER_ID,
      OPENROUTER_DECISIONS_PROVIDER_ID,
      OPENAI_DECISIONS_PROVIDER_ID,
    ]) {
      expect(getDecisionModelOption(id)?.docsUrl).toMatch(/^https:\/\//);
    }
  });

  it("defaults an unknown id to the safest reading", () => {
    expect(privacyOf("nonsense")).toBe("on-device");
    expect(isRemoteDecisionModel("nonsense")).toBe(false);
    expect(requiresRemoteOptIn("nonsense")).toBe(false);
  });
});

describe("openrouter decision models", () => {
  it("lists the free model first, so trying the feature costs nothing", () => {
    expect(OPENROUTER_DECISION_MODELS[0].id).toBe("inception/mercury-decide:free");
    expect(OPENROUTER_DECISION_MODELS[0].inputUsdPerMillion).toBe(0);
  });

  it("recognises only its own ids", () => {
    expect(isOpenRouterDecisionModel("liquid/d1")).toBe(true);
    expect(isOpenRouterDecisionModel("anthropic/claude-3.5-sonnet")).toBe(false);
    expect(isOpenRouterDecisionModel("")).toBe(false);
  });

  it("has no duplicate ids", () => {
    const ids = OPENROUTER_DECISION_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("clef decision models", () => {
  it("lists the flash model first for latency and cost", () => {
    expect(CLEF_MODELS[0].id).toBe("@cf/cloudflare/clef-flash");
    expect(CLEF_MODELS[0].latencyMs).toBeLessThan(100);
  });

  it("recognises only its own ids", () => {
    expect(isClefModel("@cf/cloudflare/clef-flash")).toBe(true);
    expect(isClefModel("@cf/cloudflare/clef")).toBe(true);
    expect(isClefModel("openai/gpt-6-luna")).toBe(false);
    expect(isClefModel("")).toBe(false);
  });
});

describe("coerceDecisionModelId", () => {
  it("keeps a known id", () => {
    expect(coerceDecisionModelId(JEV_PROVIDER_ID)).toBe(JEV_PROVIDER_ID);
    expect(coerceDecisionModelId(OPENAI_DECISIONS_PROVIDER_ID)).toBe(OPENAI_DECISIONS_PROVIDER_ID);
  });

  it("reads an unknown, removed, or malformed id as no model", () => {
    // A settings blob naming a provider this build no longer has must not throw
    // on startup, and must not silently select something.
    expect(coerceDecisionModelId("a-provider-that-was-removed")).toBe(NO_DECISION_MODEL_ID);
    expect(coerceDecisionModelId(undefined)).toBe(NO_DECISION_MODEL_ID);
    expect(coerceDecisionModelId(42)).toBe(NO_DECISION_MODEL_ID);
    expect(coerceDecisionModelId(null)).toBe(NO_DECISION_MODEL_ID);
  });
});

describe("setup gaps", () => {
  it("reports nothing missing for the routes that work out of the box", () => {
    expect(setupGaps(NO_DECISION_MODEL_ID, { allowRemote: false })).toEqual([]);
    expect(setupGaps(DECISION_SPINE_ID, { allowRemote: false })).toEqual([]);
  });

  it("requires the remote opt-in for every remote route, and says so by name", () => {
    // Without the opt-in the payload builder is unreachable, so the option would
    // silently do nothing. Naming the field lets the UI focus it.
    for (const id of [
      JEV_PROVIDER_ID,
      CLEF_PROVIDER_ID,
      OPENROUTER_DECISIONS_PROVIDER_ID,
      OPENAI_DECISIONS_PROVIDER_ID,
    ]) {
      expect(setupGaps(id, { allowRemote: false })).toContain("allowRemoteDecisionModel");
    }
  });

  it("does not require the opt-in for a route that stays on the machine", () => {
    expect(setupGaps(LAYA_PROVIDER_ID, { allowRemote: false })).toEqual([]);
    expect(setupGaps(LOCAL_DECISION_ENGINE_PROVIDER_ID, { allowRemote: false })).toEqual([]);
  });

  it("requires an API key for Jev", () => {
    expect(setupGaps(JEV_PROVIDER_ID, { allowRemote: true })).toEqual(["apiKey"]);
    expect(setupGaps(JEV_PROVIDER_ID, { allowRemote: true, apiKey: " " })).toEqual(["apiKey"]);
    expect(setupGaps(JEV_PROVIDER_ID, { allowRemote: true, apiKey: "sk-x" })).toEqual([]);
  });

  it("requires an account id and token for Clef", () => {
    expect(setupGaps(CLEF_PROVIDER_ID, { allowRemote: true })).toEqual([
      "apiKey",
      "cloudflareAccountId",
    ]);
    expect(
      setupGaps(CLEF_PROVIDER_ID, {
        allowRemote: true,
        apiKey: "cf",
        cloudflareAccountId: "acct",
      })
    ).toEqual([]);
  });

  it("requires both an OpenRouter key and a known model id", () => {
    expect(setupGaps(OPENROUTER_DECISIONS_PROVIDER_ID, { allowRemote: true })).toEqual([
      "openrouterApiKey",
      "openrouterModelId",
    ]);
    expect(
      setupGaps(OPENROUTER_DECISIONS_PROVIDER_ID, {
        allowRemote: true,
        apiKey: "or",
        openrouterModelId: "not-a-decision-model",
      })
    ).toEqual(["openrouterModelId"]);
    expect(
      setupGaps(OPENROUTER_DECISIONS_PROVIDER_ID, {
        allowRemote: true,
        apiKey: "or",
        openrouterModelId: "liquid/d1",
      })
    ).toEqual([]);
  });

  it("requires an API key for OpenAI", () => {
    expect(setupGaps(OPENAI_DECISIONS_PROVIDER_ID, { allowRemote: true })).toEqual([
      "openaiApiKey",
    ]);
    expect(
      setupGaps(OPENAI_DECISIONS_PROVIDER_ID, { allowRemote: true, apiKey: " " }),
    ).toEqual(["openaiApiKey"]);
    expect(
      setupGaps(OPENAI_DECISIONS_PROVIDER_ID, { allowRemote: true, apiKey: "sk-proj-x" }),
    ).toEqual([]);
  });

  it("reports an unknown provider as its own gap", () => {
    expect(setupGaps("nonsense", ready)).toEqual(["unknownProvider"]);
  });
});

describe("isDecisionModelReady", () => {
  it("is true only when nothing is missing", () => {
    expect(isDecisionModelReady(NO_DECISION_MODEL_ID, { allowRemote: false })).toBe(true);
    expect(isDecisionModelReady(DECISION_SPINE_ID, { allowRemote: false })).toBe(true);
    expect(isDecisionModelReady(JEV_PROVIDER_ID, { allowRemote: true })).toBe(false);
    expect(isDecisionModelReady(JEV_PROVIDER_ID, { allowRemote: true, apiKey: "sk" })).toBe(true);
    expect(isDecisionModelReady(OPENAI_DECISIONS_PROVIDER_ID, { allowRemote: true })).toBe(false);
    expect(
      isDecisionModelReady(OPENAI_DECISIONS_PROVIDER_ID, { allowRemote: true, apiKey: "sk" }),
    ).toBe(true);
    expect(isDecisionModelReady(LAYA_PROVIDER_ID, { allowRemote: false })).toBe(true);
  });
});

describe("endpoints and model names", () => {
  it("resolves each provider's documented base URL", () => {
    expect(baseUrlFor(JEV_PROVIDER_ID, ready)).toBe(JEV_BASE_URL);
    expect(baseUrlFor(LAYA_PROVIDER_ID, ready)).toBe(LAYA_DEFAULT_BASE_URL);
    expect(baseUrlFor(LOCAL_DECISION_ENGINE_PROVIDER_ID, ready)).toBe(LAYA_DEFAULT_BASE_URL);
    expect(baseUrlFor(OPENAI_DECISIONS_PROVIDER_ID, ready)).toBe(OPENAI_DECISIONS_BASE_URL);
  });

  it("builds Clef's account-scoped URL", () => {
    expect(baseUrlFor(CLEF_PROVIDER_ID, { allowRemote: true, cloudflareAccountId: "acct-1" })).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acct-1",
    );
  });

  it("honours a base URL override, with the trailing slash normalized away", () => {
    expect(baseUrlFor(JEV_PROVIDER_ID, { ...ready, baseUrl: "https://proxy.test/" })).toBe(
      "https://proxy.test",
    );
  });

  it("sends a model name only where the endpoint serves several", () => {
    expect(modelFor(JEV_PROVIDER_ID, ready)).toBe("jev-latest");
    expect(modelFor(CLEF_PROVIDER_ID, ready)).toBe("@cf/cloudflare/clef-flash");
    expect(
      modelFor(CLEF_PROVIDER_ID, { ...ready, clefModelId: "@cf/cloudflare/clef" }),
    ).toBe("@cf/cloudflare/clef");
    expect(modelFor(OPENROUTER_DECISIONS_PROVIDER_ID, ready)).toBe(
      "inception/mercury-decide:free",
    );
    expect(modelFor(OPENAI_DECISIONS_PROVIDER_ID, ready)).toBe("gpt-6-luna");
    expect(
      modelFor(OPENAI_DECISIONS_PROVIDER_ID, { ...ready, openaiModelId: "gpt-6-custom" }),
    ).toBe("gpt-6-custom");
    // Laya serves one model and rejects the field.
    expect(modelFor(LAYA_PROVIDER_ID, ready)).toBeUndefined();
    expect(modelFor(LOCAL_DECISION_ENGINE_PROVIDER_ID, ready)).toBeUndefined();
  });

  it("lets the OpenRouter model choice drive the model name", () => {
    expect(
      modelFor(OPENROUTER_DECISIONS_PROVIDER_ID, { ...ready, openrouterModelId: "liquid/d1" }),
    ).toBe("liquid/d1");
  });
});