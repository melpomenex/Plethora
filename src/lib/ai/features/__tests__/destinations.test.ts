import { describe, expect, it } from "vitest";
import {
  classifyBaseUrlLocality,
  classifyCloudDestination,
  classifyEmbeddingDestination,
  classifyNativeDestination,
  sameDestination,
} from "../destinations";

describe("destination classification", () => {
  it("treats loopback as on-device and never claims billing", () => {
    const dest = classifyCloudDestination({
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434",
    });
    expect(dest.locality).toBe("loopback");
    expect(dest.keyless).toBe(true);
    expect(dest.billable).toBe(false);
    expect(dest.sendsOffDevice).toBe(false);
    expect(dest.requiresDisclosure).toBe(false);
  });

  it("treats a remote keyless Ollama endpoint as off-device", () => {
    const dest = classifyCloudDestination({
      provider: "ollama",
      baseUrl: "https://ollama.example.com",
    });
    expect(dest.locality).toBe("remote");
    expect(dest.keyless).toBe(true);
    expect(dest.billable).toBe(false);
    expect(dest.sendsOffDevice).toBe(true);
    expect(dest.requiresDisclosure).toBe(true);
  });

  it("treats a LAN .local host as off-device (not loopback)", () => {
    const dest = classifyCloudDestination({
      provider: "ollama",
      baseUrl: "http://workstation.local:11434",
    });
    expect(dest.locality).toBe("lan");
    expect(dest.sendsOffDevice).toBe(true);
    expect(dest.requiresDisclosure).toBe(true);
  });

  it("treats RFC1918 addresses and docker host bridges as LAN", () => {
    expect(classifyBaseUrlLocality("http://192.168.1.20:11434").locality).toBe("lan");
    expect(classifyBaseUrlLocality("http://10.0.0.4:11434").locality).toBe("lan");
    expect(classifyBaseUrlLocality("http://172.20.0.3:11434").locality).toBe("lan");
    expect(classifyBaseUrlLocality("http://host.docker.internal:11434").locality).toBe("lan");
  });

  it("treats a keyless local OpenAI-compatible endpoint as loopback", () => {
    const dest = classifyCloudDestination({
      provider: "openai",
      baseUrl: "http://localhost:8080/v1",
    });
    expect(dest.locality).toBe("loopback");
    expect(dest.keyless).toBe(true);
    expect(dest.sendsOffDevice).toBe(false);
  });

  it("marks ordinary cloud providers as remote and billable", () => {
    const dest = classifyCloudDestination({
      provider: "anthropic",
      hasApiKey: true,
    });
    expect(dest.providerClass).toBe("configured-external");
    expect(dest.keyless).toBe(false);
    expect(dest.billable).toBe(true);
    expect(dest.sendsOffDevice).toBe(true);
    expect(dest.requiresCostConsent).toBe(true);
  });

  it("classifies native providers as device-local and free", () => {
    const dest = classifyNativeDestination("android-nano");
    expect(dest.locality).toBe("device");
    expect(dest.sendsOffDevice).toBe(false);
    expect(dest.billable).toBe(false);
    expect(dest.requiresDisclosure).toBe(false);
  });

  it("classifies embedding destinations independently of generation", () => {
    const local = classifyEmbeddingDestination({
      provider: "ollama",
      ollamaBaseUrl: "http://127.0.0.1:11434",
    });
    expect(local.sendsOffDevice).toBe(false);

    const remote = classifyEmbeddingDestination({
      provider: "ollama",
      ollamaBaseUrl: "https://embed.example.net",
    });
    expect(remote.sendsOffDevice).toBe(true);

    const cloud = classifyEmbeddingDestination({ provider: "openai", hasApiKey: true });
    expect(cloud.sendsOffDevice).toBe(true);
    expect(cloud.billable).toBe(true);
  });

  it("detects a changed endpoint as a different destination", () => {
    const a = classifyCloudDestination({ provider: "ollama", baseUrl: "http://127.0.0.1:11434" });
    const b = classifyCloudDestination({ provider: "ollama", baseUrl: "http://192.168.1.9:11434" });
    expect(sameDestination(a, b)).toBe(false);
  });

  it("fails closed for an unparseable endpoint", () => {
    const dest = classifyCloudDestination({ provider: "ollama", baseUrl: "not a url" });
    expect(dest.locality).toBe("unknown");
    expect(dest.sendsOffDevice).toBe(true);
  });
});
