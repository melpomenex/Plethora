import { describe, expect, it } from "vitest";
import {
  ASSISTANT_SCOPE_METADATA,
  ASSISTANT_SCOPES,
  buildScopePolicyInstruction,
  isAssistantScope,
  resolveDefaultAssistantScope,
} from "../scopes";

describe("assistant scopes contract", () => {
  it("exposes chat, document, and library scopes with expected metadata", () => {
    expect(ASSISTANT_SCOPES).toEqual(["chat", "document", "library"]);
    expect(ASSISTANT_SCOPE_METADATA.chat.allowsExternalKnowledge).toBe(true);
    expect(ASSISTANT_SCOPE_METADATA.chat.requiresSourceEvidence).toBe(false);
    expect(ASSISTANT_SCOPE_METADATA.document.allowsExternalKnowledge).toBe(false);
    expect(ASSISTANT_SCOPE_METADATA.document.requiresSourceEvidence).toBe(true);
    expect(ASSISTANT_SCOPE_METADATA.library.supportsCrossDocumentRetrieval).toBe(true);
  });

  it("defaults ordinary conversations to chat scope and preserves explicit entry points", () => {
    expect(resolveDefaultAssistantScope()).toBe("chat");
    expect(resolveDefaultAssistantScope({ entryPoint: "reader" })).toBe("chat");
    expect(resolveDefaultAssistantScope({ entryPoint: "library-palette" })).toBe("library");
    expect(resolveDefaultAssistantScope({ entryPoint: "strict-document-qa" })).toBe("document");
    expect(resolveDefaultAssistantScope({ legacyUseWholeLibraryScope: true })).toBe("library");
    expect(resolveDefaultAssistantScope({ explicitScope: "document" })).toBe("document");
  });

  it("validates scope strings accurately", () => {
    expect(isAssistantScope("chat")).toBe(true);
    expect(isAssistantScope("document")).toBe(true);
    expect(isAssistantScope("library")).toBe(true);
    expect(isAssistantScope("unknown")).toBe(false);
  });

  it("builds non-restrictive instructions for Chat scope and strict instructions for Document/Library", () => {
    const chatPrompt = buildScopePolicyInstruction("chat", {
      hasSourceContext: true,
      sourceType: "document",
    });
    expect(chatPrompt).toContain("ACTIVE SCOPE: Chat");
    expect(chatPrompt).toContain("freely draw on broader model knowledge");
    expect(chatPrompt).not.toContain("If the answer is not in the provided context, say so");

    const docPrompt = buildScopePolicyInstruction("document", {
      hasSourceContext: true,
      sourceType: "document",
    });
    expect(docPrompt).toContain("ACTIVE SCOPE: Document");
    expect(docPrompt).toContain("Do NOT silently supplement answers with unsupported outside model knowledge");

    const libPrompt = buildScopePolicyInstruction("library", {
      hasSourceContext: true,
    });
    expect(libPrompt).toContain("ACTIVE SCOPE: Library");
    expect(libPrompt).toContain("Cite supporting sources with [N] markers");
  });
});
