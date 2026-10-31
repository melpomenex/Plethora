/**
 * Catalog budget (change 4.2): the generated model-facing catalog (with
 * per-tool `args:` lines) must stay bounded for small local contexts.
 */

import { describe, expect, it } from "vitest";
import { agentToolCatalogText, agentToolCatalogCharCount } from "../registry";

describe("agent tool catalog budget", () => {
  it("describes every registered tool with its arguments", () => {
    const text = agentToolCatalogText();
    expect(text).toContain("propose_flashcard");
    expect(text).toContain("args: query: string (req)");
    expect(text).toContain("args: sourceHandle: string (opt)");
    expect(text).toContain("args: cardType: enum (opt)");
  });

  it("stays under 6,000 characters (loop fit-check fleet estimate)", () => {
    expect(agentToolCatalogCharCount()).toBeLessThan(6000);
  });
});
