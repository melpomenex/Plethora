/**
 * Destination-truth locality tests (task 2.3).
 *
 * The invariant: privacy decisions follow the *actual destination*, not the
 * provider label. A custom/remote Ollama endpoint is remote; a loopback
 * endpoint is on this machine; cloud ids are always remote.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  chainStaysLocal,
  destinationAllowsLocalOnly,
  isLoopbackBaseUrl,
  resolveDestination,
  resolveFallbackChain,
} from "../turnPolicy";
import {
  resetCloudAiDisclosure,
  setCloudAiDisclosurePresenter,
} from "../../../privacy/cloudAiDisclosure";
import { enforceAssistantPrivacyAndConsent } from "../privacyGate";

describe("resolveDestination", () => {
  it("classifies on-device providers as on-device", () => {
    for (const providerId of [
      "ondevice",
      "gemini-nano",
      "apple-foundation-models",
      "apple-core-ai",
      "windows-ai",
      "foundry-local",
    ]) {
      const resolved = resolveDestination({ providerId });
      expect(resolved.locality, providerId).toBe("on-device");
      expect(resolved.onDevice, providerId).toBe(true);
    }
  });

  it("classifies cloud providers as remote regardless of endpoint", () => {
    for (const providerId of ["openai", "anthropic", "gemini", "deepseek", "openrouter"]) {
      const resolved = resolveDestination({
        providerId,
        baseUrl: "http://localhost:11434", // even a loopback URL cannot make a cloud id local
      });
      expect(resolved.locality, providerId).toBe("remote");
    }
  });

  it("resolves Ollama locality from the endpoint", () => {
    expect(resolveDestination({ providerId: "ollama" }).locality).toBe("on-device");
    expect(
      resolveDestination({ providerId: "ollama", baseUrl: "http://localhost:11434" }).locality,
    ).toBe("on-device");
    expect(
      resolveDestination({ providerId: "ollama", baseUrl: "http://127.0.0.1:11434" }).locality,
    ).toBe("on-device");
    expect(
      resolveDestination({ providerId: "ollama", baseUrl: "https://ollama.example.com" }).locality,
    ).toBe("remote");
    expect(
      resolveDestination({ providerId: "ollama", baseUrl: "http://192.168.1.50:11434" }).locality,
    ).toBe("remote");
    // Custom OpenAI-compatible endpoints behave the same way.
    expect(
      resolveDestination({ providerId: "custom-endpoint", baseUrl: "http://10.0.0.4:8000" }).locality,
    ).toBe("remote");
    expect(resolveDestination({ providerId: "custom-endpoint" }).locality).toBe("on-device");
  });

  it("handles malformed and schemeless base URLs", () => {
    expect(isLoopbackBaseUrl("localhost:11434")).toBe(true);
    expect(isLoopbackBaseUrl("not a url")).toBe(false);
    expect(isLoopbackBaseUrl(undefined)).toBe(true);
  });

  it("treats the whole fallback chain as one privacy decision", () => {
    const chain = resolveFallbackChain([
      { providerId: "ondevice" },
      { providerId: "ollama", baseUrl: "https://remote.example.com" },
    ]);
    expect(chainStaysLocal(chain)).toBe(false);
    expect(
      chainStaysLocal(resolveFallbackChain([{ providerId: "ondevice" }, { providerId: "ollama" }])),
    ).toBe(true);
    expect(destinationAllowsLocalOnly(chain[1])).toBe(false);
  });
});

describe("privacy gate uses destination truth", () => {
  afterEach(() => {
    setCloudAiDisclosurePresenter(null);
    resetCloudAiDisclosure();
  });

  it("Blocks a local-only document from a remote custom Ollama endpoint", async () => {
    setCloudAiDisclosurePresenter(async () => true);
    const result = await enforceAssistantPrivacyAndConsent({
      documents: [{ id: "doc-1", title: "Medical Notes", isLocalOnly: true }],
      providerId: "ollama",
      baseUrl: "https://ollama.example.com",
      attachingSourceContent: true,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("local_only_provider_required");
  });

  it("Allows a local-only document from a loopback Ollama endpoint", async () => {
    const result = await enforceAssistantPrivacyAndConsent({
      documents: [{ id: "doc-1", title: "Medical Notes", isLocalOnly: true }],
      providerId: "ollama",
      baseUrl: "http://localhost:11434",
      attachingSourceContent: true,
    });
    expect(result.allowed).toBe(true);
  });

  it("Blocks strict-local-only when the resolved destination is remote", async () => {
    setCloudAiDisclosurePresenter(async () => true);
    const result = await enforceAssistantPrivacyAndConsent({
      providerId: "ollama",
      baseUrl: "http://192.168.1.50:11434",
      strictLocalOnly: true,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("local_only_provider_required");
  });

  it("Requires the cloud disclosure for a remote custom endpoint", async () => {
    let asked = false;
    setCloudAiDisclosurePresenter(async () => {
      asked = true;
      return false;
    });
    const result = await enforceAssistantPrivacyAndConsent({
      providerId: "ollama",
      baseUrl: "https://remote.example.com",
    });
    expect(asked).toBe(true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("cloud_disclosure_declined");
  });

  it("does not ask disclosure for a loopback endpoint", async () => {
    let asked = false;
    setCloudAiDisclosurePresenter(async () => {
      asked = true;
      return true;
    });
    const result = await enforceAssistantPrivacyAndConsent({
      providerId: "ollama",
      baseUrl: "http://localhost:11434",
    });
    expect(asked).toBe(false);
    expect(result.allowed).toBe(true);
  });

  it("prefers an explicitly resolved destination over the label", async () => {
    setCloudAiDisclosurePresenter(async () => false);
    const result = await enforceAssistantPrivacyAndConsent({
      providerId: "ollama",
      // Caller resolved a remote destination; the label `ollama` must not win.
      destination: { locality: "remote", localityReason: "proxied endpoint" },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("cloud_disclosure_declined");
  });
});
