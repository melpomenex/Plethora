import { beforeEach, describe, expect, it, vi } from "vitest";
import { assistantSourceProvenance, authorizeAssistantHistory } from "../provenance";
vi.mock("../../../../lib/privacy/cloudAiDisclosure", () => ({ ensureCloudAiDisclosure: vi.fn().mockResolvedValue(true) }));
vi.mock("../../../../utils/aiBillingConsent", () => ({ requestPaidConsent: vi.fn().mockResolvedValue(true) }));

describe("global conversation provenance", () => {
  const getDocument = vi.fn();
  beforeEach(() => { getDocument.mockReset(); });
  it("uses parent IDs for extracts and no fabricated RSS IDs", () => {
    expect(assistantSourceProvenance({ type: "document", documentId: "extract:e1", privacyDocumentIds: ["parent"] })?.documentIds).toEqual(["parent"]);
    expect(assistantSourceProvenance({ type: "web", url: "rss:article" })?.documentIds).toEqual([]);
    expect(assistantSourceProvenance({ type: "general" })).toBeUndefined();
  });
  it("checks historical sources again against current policy", async () => {
    getDocument.mockResolvedValue({ id: "protected", isLocalOnly: true });
    await expect(authorizeAssistantHistory({ sources: [{ documentIds: ["protected"] }], providerId: "openai", getDocument })).rejects.toThrow("Local-Only");
    expect(getDocument).toHaveBeenCalledWith("protected");
  });
  it("allows a permitted local provider but rejects exclusions", async () => {
    getDocument.mockResolvedValue({ id: "p", isLocalOnly: true });
    await expect(authorizeAssistantHistory({ sources: [{ documentIds: ["p"] }], providerId: "ollama", getDocument })).resolves.toHaveLength(1);
    getDocument.mockResolvedValue({ id: "p", isAiExcluded: true });
    await expect(authorizeAssistantHistory({ sources: [{ documentIds: ["p"] }], providerId: "ollama", getDocument })).rejects.toThrow("excluded");
  });
  it.each([null, { documentIds: [1] }, { documentIds: ["extract:e"] }, { documentIds: "bad" }])("rejects malformed or unresolved provenance %s", async source => {
    await expect(authorizeAssistantHistory({ sources: [source], providerId: "ollama", getDocument })).rejects.toThrow("privacy");
    expect(getDocument).not.toHaveBeenCalled();
  });
  it("blocks deleted sources and lookup failures", async () => {
    getDocument.mockResolvedValue(undefined);
    await expect(authorizeAssistantHistory({ sources: [{ documentIds: ["deleted"] }], providerId: "ollama", getDocument })).rejects.toThrow("unavailable");
    getDocument.mockRejectedValue(new Error("offline"));
    await expect(authorizeAssistantHistory({ sources: [{ documentIds: ["deleted"] }], providerId: "ollama", getDocument })).rejects.toThrow("unavailable");
  });
  it("supports legacy general history and web context without database lookups", async () => {
    await expect(authorizeAssistantHistory({ sources: [undefined, { documentIds: [] }], providerId: "ollama", getDocument })).resolves.toEqual([]);
    expect(getDocument).not.toHaveBeenCalled();
  });
});
