import { afterEach, describe, expect, it } from "vitest";
import {
  resetCloudAiDisclosure,
  setCloudAiDisclosurePresenter,
} from "../../../privacy/cloudAiDisclosure";
import {
  enforceAssistantPrivacyAndConsent,
  isLocalAiProviderId,
} from "../privacyGate";

describe("enforceAssistantPrivacyAndConsent", () => {
  afterEach(() => {
    setCloudAiDisclosurePresenter(null);
    resetCloudAiDisclosure();
  });

  it("identifies local vs cloud providers accurately", () => {
    expect(isLocalAiProviderId("ollama")).toBe(true);
    expect(isLocalAiProviderId("gemini-nano")).toBe(true);
    expect(isLocalAiProviderId("apple-foundation-models")).toBe(true);
    expect(isLocalAiProviderId("openai")).toBe(false);
    expect(isLocalAiProviderId("anthropic")).toBe(false);
  });

  it("blocks documents marked isAiExcluded when attaching source content", async () => {
    const res = await enforceAssistantPrivacyAndConsent({
      documents: [{ id: "doc-1", title: "Private Journal", isAiExcluded: true }],
      providerId: "ollama",
      attachingSourceContent: true,
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe("document_ai_excluded");
    expect(res.stripSourceContent).toBe(true);
  });

  it("blocks documents marked isLocalOnly from cloud providers but allows local providers", async () => {
    const cloudRes = await enforceAssistantPrivacyAndConsent({
      documents: [{ id: "doc-2", title: "Medical Notes", isLocalOnly: true }],
      providerId: "openai",
      attachingSourceContent: true,
    });
    expect(cloudRes.allowed).toBe(false);
    expect(cloudRes.reason).toBe("local_only_provider_required");

    const localRes = await enforceAssistantPrivacyAndConsent({
      documents: [{ id: "doc-2", title: "Medical Notes", isLocalOnly: true }],
      providerId: "ollama",
      attachingSourceContent: true,
    });
    expect(localRes.allowed).toBe(true);
    expect(localRes.stripSourceContent).toBe(false);
  });

  it("enforces strictLocalOnly across all requests", async () => {
    const res = await enforceAssistantPrivacyAndConsent({
      documents: [],
      providerId: "anthropic",
      strictLocalOnly: true,
      attachingSourceContent: false,
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe("local_only_provider_required");
  });

  it("denies cloud execution when cloud disclosure presenter is declined", async () => {
    setCloudAiDisclosurePresenter(async () => false);
    const res = await enforceAssistantPrivacyAndConsent({
      documents: [{ id: "doc-3", title: "Public Paper" }],
      providerId: "openai",
      attachingSourceContent: true,
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe("cloud_disclosure_declined");
  });
});
